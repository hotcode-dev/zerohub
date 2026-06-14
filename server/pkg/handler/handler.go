// Package handler provides the HTTP routing and WebSocket upgrade logic
// for the ZeroHub signaling server. It maps HTTP paths to hub management
// methods and upgrades connections to WebSocket for bidirectional
// protobuf communication.
//
// Hub Types
// The server supports four hub "modes", each backed by a separate
// ZeroHub instance:
//
//	- Static (/v1/hubs/*): Hub ID is supplied by the client (query parameter `id`).
//	- Random (/v1/random-hubs/*): Server generates a unique ID when creating.
//	- IP (/v1/ip-hubs/*): Hub ID is derived from the client's remote IP address.
//	- Permanent (/v1/permanent-hubs/*): Hub never expires; used for always-on
//	  collaboration rooms.
//
// Routing Summary
//
//	Path                                       Method     Hub Type    Description
//	/v1/status                                 GET        -           Health / version endpoint
//	/v1/admin/migrate                          GET        -           Trigger zero-downtime migration
//	/v1/hubs/create                            GET        Static      Create a new static hub
//	/v1/hubs/join                              GET        Static      Join an existing static hub
//	/v1/hubs/join-or-create                    GET        Static      Join or create a static hub
//	/v1/hubs/get                               GET        Static      Get hub metadata
//	/v1/random-hubs/create                     GET        Random      Create a random-hub
//	/v1/random-hubs/join                       GET        Random      Join an existing random-hub
//	/v1/random-hubs/get                        GET        Random      Get hub metadata
//	/v1/ip-hubs/join-or-create                 GET        IP          Join or create an IP-keyed hub
//	/v1/ip-hubs/join                           GET        IP          Join an IP-keyed hub
//	/v1/permanent-hubs/join                    GET        Permanent   Join a permanent hub
//	/v1/permanent-hubs/create                  GET        Permanent   Create a permanent hub
//
// All non-status endpoints require an HTTP GET with a query parameter `id`
// (or `peerMetadata` / `hubMetadata`). After the HTTP handshake, the
// connection is upgraded to WebSocket where protobuf messages flow in
// both directions (see proto/zerohub/v1/client_message.proto and
// server_message.proto).
package handler

import (
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/config"
	"github.com/hotcode-dev/zerohub/pkg/hub"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	limiter "github.com/ulule/limiter/v3"
	limiterFasthttp "github.com/ulule/limiter/v3/drivers/middleware/fasthttp"
	limiterMemory "github.com/ulule/limiter/v3/drivers/store/memory"
	"github.com/valyala/fasthttp"
)

// Handler defines the HTTP endpoints and WebSocket upgrade logic for the server.
type Handler interface {
	// CreateHubStatic creates a new hub with the given ID and upgrades the connection.
	// Corresponds to: GET /v1/hubs/create
	CreateHubStatic(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error
	// CreateHubRandom creates a hub with a server-assigned random ID and upgrades.
	// Corresponds to: GET /v1/random-hubs/create
	CreateHubRandom(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error
	// JoinHub joins an existing hub by ID and upgrades the connection.
	// Corresponds to: GET /v1/hubs/join
	JoinHub(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error
	// JoinOrCreateHubStatic joins a static hub if it exists, otherwise creates it.
	// Corresponds to: GET /v1/hubs/join-or-create
	JoinOrCreateHubStatic(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error
	// JoinOrCreateHubIP is the IP-keyed variant of JoinOrCreateHubStatic.
	// Corresponds to: GET /v1/ip-hubs/join-or-create
	JoinOrCreateHubIP(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error
	// GetHub returns hub metadata (peers, creation time, metadata).
	// Corresponds to: GET /v1/hubs/get
	GetHub(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error

	// Status returns server health / version information.
	// Corresponds to: GET /v1/status
	Status(ctx *fasthttp.RequestCtx) error

	// CreateHubByID is a helper for static hub creation — used internally by CreateHubStatic.
	CreateHubByID(ctx *fasthttp.RequestCtx, zeroHub zerohub.ZeroHub, hubId string) error
	// JoinOrCreateHubByID is a helper for join-or-create — used internally by JoinOrCreateHubStatic.
	JoinOrCreateHubByID(ctx *fasthttp.RequestCtx, zeroHub zerohub.ZeroHub, hubId string) error

	// Migrate updates the backup host for zero-downtime deployment.
	// Corresponds to: GET /v1/admin/migrate?host=<new-host>
	Migrate(ctx *fasthttp.RequestCtx) error
	// CreateHubPermanent creates a hub that never expires.
	// Corresponds to: GET /v1/permanent-hubs/create
	CreateHubPermanent(ctx *fasthttp.RequestCtx) error

	// Upgrade completes the HTTP handshake and returns the handler for
	// WebSocket communication.
	Upgrade(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub, hub hub.Hub) error

	// Serve starts the fasthttp server on the configured address.
	Serve() error
}

// handler implements the Handler interface.
type handler struct {
	// address is the address to listen on.
	address string
	// clientSecret is the client secret to use for authentication.
	clientSecret string

	// isMigrating is a flag that indicates whether the server is migrating.
	isMigrating bool
	// backupHost is the host to redirect to when migrating.
	backupHost string

	// zeroHub is the default ZeroHub instance.
	zeroHub zerohub.ZeroHub
	// zeroHubRandom is the ZeroHub instance for random hubs.
	zeroHubRandom zerohub.ZeroHub
	// zeroHubIP is the ZeroHub instance for IP hubs.
	zeroHubIP zerohub.ZeroHub
	// zeroHubPermanent is the ZeroHub instance for permanent hubs.
	zeroHubPermanent zerohub.ZeroHub
}

// NewHandler create a new handler
func NewHandler(cfg *config.Config, zeroHub zerohub.ZeroHub, zeroHubRandom zerohub.ZeroHub, zeroHubIP zerohub.ZeroHub, zerohubPermanent zerohub.ZeroHub) (Handler, error) {
	return &handler{
		address:          fmt.Sprintf("%s:%s", cfg.App.Host, cfg.App.Port),
		clientSecret:     cfg.App.ClientSecret,
		isMigrating:      false,
		backupHost:       "",
		zeroHub:          zeroHub,
		zeroHubRandom:    zeroHubRandom,
		zeroHubIP:        zeroHubIP,
		zeroHubPermanent: zerohubPermanent,
	}, nil
}

func (h *handler) Serve() error {
	// TODO: replace limiter with non library rate limiter
	rate, err := limiter.NewRateFromFormatted("60-M") // 60 requests per minute.
	if err != nil {
		return fmt.Errorf("error to create rate: %w", err)
	}
	rateLimitMiddleware := limiterFasthttp.NewMiddleware(limiter.New(limiterMemory.NewStore(), rate, limiter.WithTrustForwardHeader(true)))

	requestHandler := func(ctx *fasthttp.RequestCtx) {
		log.Debug().Msgf("%s %s", ctx.Method(), ctx.RequestURI())

		var err error
		switch string(ctx.Path()) {
		case "/v1/status":
			err = h.Status(ctx)
		case "/v1/admin/migrate":
			err = h.Migrate(ctx)
		// TODO: remove static hub
		case "/v1/hubs/create":
			err = h.CreateHubStatic(ctx, h.zeroHub)
		case "/v1/hubs/get":
			err = h.GetHub(ctx, h.zeroHub)
		case "/v1/hubs/join":
			err = h.JoinHub(ctx, h.zeroHub)
		case "/v1/hubs/join-or-create":
			err = h.JoinOrCreateHubStatic(ctx, h.zeroHub)
		case "/v1/random-hubs/create":
			err = h.CreateHubRandom(ctx, h.zeroHubRandom)
		case "/v1/random-hubs/get":
			err = h.GetHub(ctx, h.zeroHubRandom)
		case "/v1/random-hubs/join":
			err = h.JoinHub(ctx, h.zeroHubRandom)
		case "/v1/ip-hubs/join-or-create":
			err = h.JoinOrCreateHubIP(ctx, h.zeroHubIP)
		case "/v1/ip-hubs/join":
			err = h.JoinHub(ctx, h.zeroHubIP)
		// TODO: rename permanent-hubs to static-hubs
		case "/v1/permanent-hubs/join":
			err = h.JoinHub(ctx, h.zeroHubPermanent)
		case "/v1/permanent-hubs/create":
			err = h.CreateHubPermanent(ctx)
		default:
			ctx.Error("unsupported path", fasthttp.StatusNotFound)
			return
		}
		if err != nil {
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
