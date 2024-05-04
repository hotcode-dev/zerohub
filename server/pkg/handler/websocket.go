package handler

import (
	"fmt"

	"github.com/fasthttp/websocket"
	"github.com/hotcode-dev/zerohub/pkg/config"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
)

var upgrader = websocket.FastHTTPUpgrader{
	HandshakeTimeout: config.WSHandshakeTimeout,
	ReadBufferSize:   config.WSReadBufferSize,
	WriteBufferSize:  config.WSWriteBufferSize,
	CheckOrigin:      func(ctx *fasthttp.RequestCtx) bool { return true },
}

func (h *handler) Upgrade(ctx *fasthttp.RequestCtx, hub zerohub.Hub) error {
	err := upgrader.Upgrade(ctx, func(ws *websocket.Conn) {
		peer := zerohub.NewPeer(ws, string(ctx.QueryArgs().Peek("peerMetadata")))
		hub.AddPeer(peer)

		ws.SetCloseHandler(func(code int, text string) error {
			// https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/close
			ws.Close()
			hub.RemovePeerById(peer.GetId())
			return nil
		})

		peer.HandleMessage()

		ws.Close()
		hub.RemovePeerById(peer.GetId())
	})

	if err != nil {
		if _, ok := err.(websocket.HandshakeError); ok {
			return fmt.Errorf("websocket handshake: %v", err)
		}
		return fmt.Errorf("websocket upgrade error: %v", err)
	}

	return nil
}
