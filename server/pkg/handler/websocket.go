package handler

import (
	"fmt"
	"net/url"
	"slices"
	"strings"

	"github.com/fasthttp/websocket"
	"github.com/hotcode-dev/zerohub/pkg/config"
	"github.com/hotcode-dev/zerohub/pkg/hub"
	"github.com/hotcode-dev/zerohub/pkg/peer"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
)

// parseAllowedOrigins splits the comma-separated APP_ALLOWED_ORIGINS value
// into a trimmed list. Empty entries (e.g. trailing commas) are dropped.
func parseAllowedOrigins(raw string) []string {
	var allowed []string
	for _, origin := range strings.Split(raw, ",") {
		if o := strings.TrimSpace(origin); o != "" {
			allowed = append(allowed, o)
		}
	}
	return allowed
}

// sameOriginOrAllowed is the upgrader's CheckOrigin. A request carrying an
// Origin header is accepted only when the origin host equals the request
// Host — case-insensitively, matching the fasthttp/websocket library's
// default, fastHTTPcheckSameOrigin (equalASCIIFold) — or the full origin
// value appears in the explicit APP_ALLOWED_ORIGINS allow-list. Requests
// without an Origin header (non-browser / tooling clients) are accepted,
// mirroring the library default. A request with an unparseable Origin is
// rejected.
//
// SECURITY: this gate blocks cross-site WebSocket hijacking — without it a
// malicious page in a victim's browser could open the signaling socket from
// any origin and observe the peer roster and signaling stream of a known
// hub. Do not re-open it with a blanket "return true".
func sameOriginOrAllowed(ctx *fasthttp.RequestCtx, allowedOrigins []string) bool {
	origin := string(ctx.Request.Header.Peek("Origin"))
	if origin == "" {
		return true
	}
	if slices.Contains(allowedOrigins, origin) {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return strings.EqualFold(u.Host, string(ctx.Host()))
}

// newWSUpgrader builds the shared WebSocket upgrader with origin validation
// wired to the configured APP_ALLOWED_ORIGINS allow-list.
func (h *handler) newWSUpgrader() *websocket.FastHTTPUpgrader {
	return &websocket.FastHTTPUpgrader{
		HandshakeTimeout: config.WSHandshakeTimeout,
		ReadBufferSize:   config.WSReadBufferSize,
		WriteBufferSize:  config.WSWriteBufferSize,
		CheckOrigin: func(ctx *fasthttp.RequestCtx) bool {
			return sameOriginOrAllowed(ctx, h.allowedOrigins)
		},
	}
}

// Upgrade upgrades the connection to a websocket connection. A malformed
// `peerMetadata` is rejected up front with a 400 (returned as a nil error
// with responseWritten=true); any other failure is a handshake error.
// When responseWritten is true the caller must not write another response.
func (h *handler) Upgrade(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub, hub hub.Hub) (error, bool) {
	// Reject a malformed `peerMetadata` before the handshake: once upgraded,
	// the connection is a websocket and no HTTP status can be sent.
	if !validJSONQueryParam(ctx, "peerMetadata") {
		// rejectInvalidJSONParam writes the 400 via Response (which
		// returns nil on success); it returns an error only if the body
		// itself fails to marshal, in which case it has set 500.
		//
		// Note: the response is already written, so the returned error is
		// nil here — responseWritten=true is what signals "upgrade did not
		// happen" to the caller.
		_ = h.rejectInvalidJSONParam(ctx, "peerMetadata")
		return nil, true
	}

	upgradeErr := h.newWSUpgrader().Upgrade(ctx, func(ws *websocket.Conn) {
		peer := peer.NewPeer(ws, string(ctx.QueryArgs().Peek("peerMetadata")))
		hub.AddPeer(peer)

		ws.SetCloseHandler(func(code int, text string) error {
			// https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/close
			peer.Close()
			if hub.RemovePeerById(peer.GetId()) {
				zh.RemoveHubById(hub.GetId())
			}

			return nil
		})

		hub.HandleMessage(peer)

		// Close may already have run in the close handler; GetWSConn is
		// nil after Close, so this only fires if the loop exited first.
		if peer.GetWSConn() != nil {
			peer.Close()
		}
		// Safe when the close handler already removed the peer:
		// RemovePeerById is idempotent and returns false for a missing peer.
		if hub.RemovePeerById(peer.GetId()) {
			zh.RemoveHubById(hub.GetId())
		}
	})

	if upgradeErr != nil {
		if _, ok := upgradeErr.(websocket.HandshakeError); ok {
			return fmt.Errorf("websocket handshake: %v", upgradeErr), false
		}
		return fmt.Errorf("websocket upgrade error: %v", upgradeErr), false
	}

	return nil, false
}
