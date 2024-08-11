package handler

import (
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

func (h *handler) CreateHub(ctx *fasthttp.RequestCtx) error {
	if h.isMigrating {
		return h.ForwardMigrate(ctx)
	}

	hubId := string(ctx.QueryArgs().Peek("id"))
	if h.zh.GetHubById(hubId) != nil {
		log.Error().Err(fmt.Errorf("hub with id %s already exists", hubId)).Send()
		return h.Response(ctx, fasthttp.StatusConflict, map[string]string{"error": "hub id already exists"})
	}

	hub, err := zerohub.NewHub(hubId, string(ctx.QueryArgs().Peek("hubMetadata")), false)
	if err != nil {
		log.Error().Err(fmt.Errorf("new hub error: %w", err)).Send()
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "create hub error"})
	}
	h.zh.AddHub(hub)

	if err := h.Upgrade(ctx, hub); err != nil {
		// remove the hub if if the upgrad failed
		h.zh.RemoveHubById(hub.GetId())
		log.Error().Err(fmt.Errorf("websocket upgrade error: %w", err)).Send()
		return err
	}

	return nil
}
