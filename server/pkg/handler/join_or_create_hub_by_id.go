package handler

import (
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

func (h *handler) JoinOrCreateHubByID(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub, hubId string) error {
	hub := zh.GetHubById(hubId)
	if hub == nil {
		// create a new hub if it does not exist
		newHub, err := zerohub.NewHub(hubId, string(ctx.QueryArgs().Peek("hubMetadata")), false)
		if err != nil {
			log.Error().Err(fmt.Errorf("new hub error: %w", err)).Send()
			return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "create hub error"})
		}
		zh.AddHub(newHub)
		hub = newHub
	}

	if err := h.Upgrade(ctx, hub); err != nil {
		log.Error().Err(fmt.Errorf("websocket upgrade error: %w", err)).Send()
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "websocket upgrade error"})
	}

	return nil
}
