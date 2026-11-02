// Package handler provides the HTTP routing and WebSocket upgrade logic
// for the ZeroHub signaling server. It maps HTTP paths to hub management
// methods and upgrades connections to WebSocket for bidirectional
// protobuf communication.
//
// Hub Types
// The server supports three hub "modes", each backed by a separate
// ZeroHub instance:
//
//   - Static (/v1/static-hubs/*): Hub ID is supplied by the client. A static
//     hub never expires — it is created out-of-band by an admin over plain
//     HTTP (`/v1/static-hubs/create`, admin-gated) and joined via WebSocket
//     (`/v1/static-hubs/join`). Used for always-on collaboration rooms.
//   - Random (/v1/random-hubs/*): Server generates a unique ID when creating.
//   - IP (/v1/ip-hubs/*): Hub ID is derived from the client IP — the socket
//     peer address, or the X-Forwarded-For entry when APP_TRUST_PROXY is set.
//
// Routing Summary
//
//	Path                                       Method     Hub Type    Description
//	/v1/status                                 GET        -           Health / version endpoint
//	/v1/admin/migrate                          GET        -           Trigger zero-downtime migration
//	/v1/static-hubs/create                     GET        Static      Create a static (never-expires) hub; admin-gated plain HTTP (cross-mode collision-checked against random: 409 if the id exists in another mode's storage)
//	/v1/static-hubs/join                       GET        Static      Join an existing static hub
//	/v1/random-hubs/create                     GET        Random      Create a random-hub
//	/v1/random-hubs/join                       GET        Random      Join an existing random-hub
//	/v1/random-hubs/get                        GET        Random      Get hub metadata
//	/v1/ip-hubs/join-or-create                 GET        IP          Join or create an IP-keyed hub
//
// All non-status endpoints require an HTTP GET with a query parameter `id`
// (or `peerMetadata` / `hubMetadata`). After the HTTP handshake, the
// connection is upgraded to WebSocket where protobuf messages flow in
// both directions (see proto/zerohub/v1/client_message.proto and
// server_message.proto).
package handler

import (
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/hotcode-dev/zerohub/pkg/config"
	"github.com/hotcode-dev/zerohub/pkg/hub"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// Handler defines the HTTP endpoints and WebSocket upgrade logic for the server.
type Handler interface {
	// CreateHubRandom creates a hub with a server-assigned random ID and upgrades.
	// Corresponds to: GET /v1/random-hubs/create
	CreateHubRandom(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error
	// JoinHub joins an existing hub by ID and upgrades the connection.
	// Serves the static hub join (GET /v1/static-hubs/join) and the random
	// hub join (GET /v1/random-hubs/join); the caller picks the backing
	// ZeroHub instance.
	JoinHub(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error
	// JoinOrCreateHubIP is the IP-keyed join-or-create variant.
	// Corresponds to: GET /v1/ip-hubs/join-or-create
	JoinOrCreateHubIP(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error
	// GetHub returns the hub (id, creation time, metadata, isPermanent flag).
	// It is a plain HTTP GET read endpoint; it does not upgrade to WebSocket
	// and does not expose the peer roster.
	// Corresponds to: GET /v1/random-hubs/get
	GetHub(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error

	// Status returns server health / version information.
	// Corresponds to: GET /v1/status
	Status(ctx *fasthttp.RequestCtx) error

	// CreateHubByID is a helper for random hub creation — used internally by CreateHubRandom.
	CreateHubByID(ctx *fasthttp.RequestCtx, zeroHub zerohub.ZeroHub, hubId string) error
	// JoinOrCreateHubByID is a helper for join-or-create — used internally by JoinOrCreateHubIP.
	JoinOrCreateHubByID(ctx *fasthttp.RequestCtx, zeroHub zerohub.ZeroHub, hubId string) error

	// Migrate updates the backup host for zero-downtime deployment.
	// Corresponds to: GET /v1/admin/migrate?host=<new-host>
	Migrate(ctx *fasthttp.RequestCtx) error
	// CreateStaticHub creates a static hub that never expires. It is the
	// admin-gated, plain-HTTP create for the static family (no WebSocket
	// upgrade, no peer added).
	// Corresponds to: GET /v1/static-hubs/create
	CreateStaticHub(ctx *fasthttp.RequestCtx) error

	// Upgrade completes the HTTP handshake and returns the handler for
	// WebSocket communication. On failure, responseWritten is true when an
	// HTTP response has already been written for the request; callers must
	// not overwrite it.
	Upgrade(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub, hub hub.Hub) (error, bool)

	// Serve starts the fasthttp server on the configured address.
	Serve() error
}

// handler implements the Handler interface.
type handler struct {
	// address is the address to listen on.
	address string
	// clientSecret is the client secret to use for authentication.
	clientSecret string
	// trustProxy gates whether per-client identity may be derived from the
	// X-Forwarded-For header: the rate limiter keys its per-client budget and
	// IP-keyed hubs key their hub ID from that header. It must only be true
	// behind a reverse proxy that sanitizes that header; otherwise the socket
	// peer address is used, which is unspoofable.
	trustProxy bool

	// migrateMu guards the migration state below. The two fields must be
	// consistent as a unit: isMigrating must imply backupHost != "".
	migrateMu sync.RWMutex
	// isMigrating is a flag that indicates whether the server is migrating.
	// Read without migrateMu; the atomic access is required because many
	// fasthttp worker goroutines read it concurrently with the Migrate writer.
	isMigrating atomic.Bool
	// backupHost is the host to redirect to when migrating.
	// Access under migrateMu (read/write lock) alongside isMigrating.
	backupHost string

	// zeroHubStatic is the ZeroHub instance for the static hub family — the
	// never-expires named hubs created out-of-band by an admin over plain
	// HTTP and joined via WebSocket.
	zeroHubStatic zerohub.ZeroHub
	// zeroHubRandom is the ZeroHub instance for random hubs.
	zeroHubRandom zerohub.ZeroHub
	// zeroHubIP is the ZeroHub instance for IP hubs.
	zeroHubIP zerohub.ZeroHub
	// allowedOrigins is the parsed APP_ALLOWED_ORIGINS allow-list used by the
	// WebSocket upgrader's CheckOrigin (see sameOriginOrAllowed). Requests
	// without an Origin or whose Origin host matches the request Host are
	// always allowed; this list only widens the gate for explicitly listed
	// origins.
	allowedOrigins []string

	// wsIdleTimeout bounds a signaling connection with no inbound frames
	// (pong or data) before it is closed as dead; wsPingInterval is how
	// often the keepalive pings. Both default to the config values and are
	// only overridden by tests, which shrink them to keep liveness
	// assertions fast.
	wsIdleTimeout  time.Duration
	wsPingInterval time.Duration
}

// idleTimeout / pingInterval return the effective probe timings, falling
// back to the config defaults when the handler was built by NewHandler
// (which leaves the fields at zero).
func (h *handler) idleTimeout() time.Duration {
	if h.wsIdleTimeout > 0 {
		return h.wsIdleTimeout
	}
	return config.WSIdleTimeout
}

func (h *handler) pingInterval() time.Duration {
	if h.wsPingInterval > 0 {
		return h.wsPingInterval
	}
	// One quarter of the idle window: pings only keep intermediates' idle
	// mappings alive, so a shorter interval is harmless (the library's
	// auto-pong replies are invisible to the read path), while a longer
	// one would let a half-open peer sit one whole idle window with no
	// probe in flight before the next tick can close it.
	return config.WSIdleTimeout / 4
}

// NewHandler create a new handler
func NewHandler(cfg *config.Config, zeroHubStatic zerohub.ZeroHub, zeroHubRandom zerohub.ZeroHub, zeroHubIP zerohub.ZeroHub) (Handler, error) {
	if cfg.App.ClientSecret == "" {
		return nil, fmt.Errorf("APP_CLIENT_SECRET must not be empty: an empty secret would leave admin endpoints open to unauthenticated requests")
	}
	return &handler{
		address:        fmt.Sprintf("%s:%s", cfg.App.Host, cfg.App.Port),
		clientSecret:   cfg.App.ClientSecret,
		trustProxy:     cfg.App.TrustProxy,
		zeroHubStatic:  zeroHubStatic,
		zeroHubRandom:  zeroHubRandom,
		zeroHubIP:      zeroHubIP,
		allowedOrigins: parseAllowedOrigins(cfg.App.AllowedOrigins),
	}, nil
}

// clientIP returns the client IP used as the IP-hub identity key: the value
// that JoinOrCreateHubIP hashes into the hub ID. When trustProxy is set
// (the server sits behind a trusted reverse proxy), it is the first
// (outermost) entry of X-Forwarded-For; otherwise the socket peer's IP
// address (no port), which is unspoofable.
//
// This is the IP-hub key only — NOT the rate-limiter key. The limiter keys
// on a deliberately different derivation (remoteAddrKey / forwardedIPKey):
// its non-trustProxy key is the full socket address, IP:port, so each TCP
// connection gets its own per-client DoS budget, whereas clientIP drops the
// port so that every connection from one client IP lands in the same hub —
// the same-network grouping IP hubs exist for. The two sources are
// therefore intentionally different; do not "unify" clientIP with the
// limiter's key without re-checking both the per-socket throttle
// (ratelimit_test.go) and the IP-hub grouping tests below.
//
// SECURITY: safe only behind a proxy that strips or replaces
// X-Forwarded-For; in front of an untrusted hop any client could forge a
// fresh hub IP per request.
func (h *handler) clientIP(ctx *fasthttp.RequestCtx) string {
	if h.trustProxy {
		if ip := ipFromForwardedHeader(ctx); ip != "" {
			return ip
		}
	}
	return ctx.RemoteIP().String()
}

// remoteAddrKey returns the unspoofable TCP socket peer address, IP:port.
// It is the rate limiter's default key: because it includes the port, each
// socket (rather than each IP) gets its own per-client budget, the most
// conservative DoS stance. It is deliberately NOT the IP-hub key, which
// drops the port so that all connections from one IP share one hub.
func remoteAddrKey(ctx *fasthttp.RequestCtx) string {
	return ctx.RemoteAddr().String()
}

// forwardedIPKey returns the client IP recorded by a trusted reverse proxy
// in X-Forwarded-For, falling back to the socket peer address
// (remoteAddrKey) when the header is absent or unparseable.
//
// This is the rate limiter's key when trustProxy is set: the sanitized
// X-Forwarded-For value identifies the real client behind the proxy, so the
// per-client budget is applied per real client, never per socket. It is not
// used as an IP-hub key — IP hubs key by the port-less clientIP.
//
// SECURITY: safe only behind a proxy that strips or replaces
// X-Forwarded-For; in front of an untrusted hop any client could forge a
// fresh "IP" per request and defeat the per-client DoS throttle.
func forwardedIPKey(ctx *fasthttp.RequestCtx) string {
	if ip := ipFromForwardedHeader(ctx); ip != "" {
		return ip
	}
	return remoteAddrKey(ctx)
}

// ipFromForwardedHeader returns the first (outermost) IP in the
// X-Forwarded-For header, or "" when the header is absent or unparseable.
func ipFromForwardedHeader(ctx *fasthttp.RequestCtx) string {
	xff := string(ctx.Request.Header.Peek("X-Forwarded-For"))
	if xff == "" {
		return ""
	}
	// Take the first (outermost) entry; a well-behaved proxy puts the real
	// client address there and appends hop addresses after it.
	first := strings.SplitN(xff, ",", 2)[0]
	ip := net.ParseIP(strings.TrimSpace(first))
	if ip == nil {
		return ""
	}
	return ip.String()
}

func (h *handler) Serve() error {
	rateLimitMiddleware, err := newRateLimitMiddleware(h.trustProxy)
	if err != nil {
		return err
	}

	requestHandler := func(ctx *fasthttp.RequestCtx) {
		log.Debug().Msgf("%s %s", ctx.Method(), ctx.RequestURI())

		var err error
		switch string(ctx.Path()) {
		case "/v1/status":
			err = h.Status(ctx)
		case "/v1/admin/migrate":
			err = h.Migrate(ctx)
		case "/v1/static-hubs/join":
			err = h.JoinHub(ctx, h.zeroHubStatic)
		case "/v1/static-hubs/create":
			err = h.CreateStaticHub(ctx)
		case "/v1/random-hubs/create":
			err = h.CreateHubRandom(ctx, h.zeroHubRandom)
		case "/v1/random-hubs/get":
			err = h.GetHub(ctx, h.zeroHubRandom)
		case "/v1/random-hubs/join":
			err = h.JoinHub(ctx, h.zeroHubRandom)
		case "/v1/ip-hubs/join-or-create":
			err = h.JoinOrCreateHubIP(ctx, h.zeroHubIP)
		default:
			ctx.Error("unsupported path", fasthttp.StatusNotFound)
			return
		}
		if err != nil {
			// CheckAdminAuth already wrote the 401 response; do not
			// overwrite it with a generic 503.
			if errors.Is(err, errAdminUnauthorized) {
				return
			}
			log.Error().Err(err)
			ctx.Error(err.Error(), fasthttp.StatusServiceUnavailable)
		}
	}

	server := &fasthttp.Server{
		Handler:            rateLimitMiddleware.Handle(requestHandler),
		Name:               "ZeroHub",
		MaxRequestBodySize: config.HTTPMaxRequestBodySize,
	}

	log.Info().Msgf("listening to %s", h.address)
	if err := server.ListenAndServe(h.address); err != nil {
		return fmt.Errorf("error to ListenAndServe: %w", err)
	}

	return nil
}
