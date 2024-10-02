package handler

import (
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

func (h *handler) CreateHubByID(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub, hubId string) error {
	hub, err := zerohub.NewHub(hubId, string(ctx.QueryArgs().Peek("hubMetadata")), false)
	if err != nil {
		log.Error().Err(fmt.Errorf("new hub error: %w", err)).Send()
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "create hub error"})
	}
	zh.AddHub(hub)

	if err := h.Upgrade(ctx, hub); err != nil {
		// remove the hub if the upgrade failed
		zh.RemoveHubById(hub.GetId())
		log.Error().Err(fmt.Errorf("websocket upgrade error: %w", err)).Send()
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "websocket upgrade error"})
	}

	return nil
}
