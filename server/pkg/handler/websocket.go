package handler

import (
	"fmt"

	"github.com/fasthttp/websocket"
	"github.com/hotcode-dev/zerohub/pkg/config"
	"github.com/hotcode-dev/zerohub/pkg/hub"
	"github.com/hotcode-dev/zerohub/pkg/peer"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

var upgrader = websocket.FastHTTPUpgrader{
	HandshakeTimeout: config.WSHandshakeTimeout,
	ReadBufferSize:   config.WSReadBufferSize,
	WriteBufferSize:  config.WSWriteBufferSize,
	CheckOrigin:      func(ctx *fasthttp.RequestCtx) bool { return true },
}

// Upgrade upgrades the connection to a websocket connection.
func (h *handler) Upgrade(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub, hub hub.Hub) error {
	err := upgrader.Upgrade(ctx, func(ws *websocket.Conn) {
		peer := peer.NewPeer(ws, string(ctx.QueryArgs().Peek("peerMetadata")))
		hub.AddPeer(peer)

		ws.SetCloseHandler(func(code int, text string) error {
			// https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/close
			ws.Close()
			if hub.RemovePeerById(peer.GetId()) {
				if err := zh.RemoveHubById(hub.GetId()); err != nil {
					log.Error().Err(err).Str("hubId", hub.GetId()).Msg("failed to remove hub on peer close")
				}
			}

			return nil
		})

		hub.HandleMessage(peer)

		ws.Close()
		if hub.RemovePeerById(peer.GetId()) {
			if err := zh.RemoveHubById(hub.GetId()); err != nil {
				log.Error().Err(err).Str("hubId", hub.GetId()).Msg("failed to remove hub on peer cleanup")
			}
		}
	})

	if err != nil {
		if _, ok := err.(websocket.HandshakeError); ok {
			return fmt.Errorf("websocket handshake: %v", err)
		}
		return fmt.Errorf("websocket upgrade error: %v", err)
	}

	return nil
}
