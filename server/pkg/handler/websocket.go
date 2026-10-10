package handler

import (
	"fmt"

	"github.com/fasthttp/websocket"
	"github.com/hotcode-dev/zerohub/pkg/config"
	"github.com/hotcode-dev/zerohub/pkg/hub"
	"github.com/hotcode-dev/zerohub/pkg/peer"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
)

var upgrader = websocket.FastHTTPUpgrader{
	HandshakeTimeout: config.WSHandshakeTimeout,
	ReadBufferSize:   config.WSReadBufferSize,
	WriteBufferSize:  config.WSWriteBufferSize,
	CheckOrigin:      func(ctx *fasthttp.RequestCtx) bool { return true },
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

	upgradeErr := upgrader.Upgrade(ctx, func(ws *websocket.Conn) {
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
