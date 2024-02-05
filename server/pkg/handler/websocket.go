package handler

import (
	"fmt"

	"github.com/fasthttp/websocket"
	"github.com/ntsd/zero-hub/server/pkg/zerohub"
	"github.com/valyala/fasthttp"
)

var upgrader = websocket.FastHTTPUpgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(ctx *fasthttp.RequestCtx) bool { return true },
}

func (h *handler) Upgrade(ctx *fasthttp.RequestCtx, hub zerohub.Hub) error {
	err := upgrader.Upgrade(ctx, func(ws *websocket.Conn) {
		peer := zerohub.NewPeer(ws, string(ctx.QueryArgs().Peek("metaData")))
		hub.AddPeer(peer)

		ws.SetCloseHandler(func(code int, text string) error {
			// https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/close
			ws.Close()
			hub.RemovePeerByID(peer.GetID())
			return nil
		})

		peer.HandleMessage()

		ws.Close()
		hub.RemovePeerByID(peer.GetID())
	})

	if err != nil {
		if _, ok := err.(websocket.HandshakeError); ok {
			return fmt.Errorf("websocket handshake: %v", err)
		}
		return fmt.Errorf("websocket upgrade error: %v", err)
	}

	return nil
}
