package handler

import (
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

func (h *handler) CreateHubPermanent(ctx *fasthttp.RequestCtx) error {
	if h.isMigrating {
		return h.ForwardMigrate(ctx)
	}

	if err := h.CheckAdminAuth(ctx); err != nil {
		return err
	}

	hubId := string(ctx.QueryArgs().Peek("id"))
	if h.zeroHub.GetHubById(hubId) != nil {
		log.Error().Err(fmt.Errorf("hub with id %s already exists", hubId)).Send()
		return h.Response(ctx, fasthttp.StatusConflict, map[string]string{"error": "hub id already exists"})
	}

	hub, err := zerohub.NewHub(hubId, string(ctx.QueryArgs().Peek("hubMetadata")), true)
	if err != nil {
		log.Error().Err(fmt.Errorf("new hub error: %w", err)).Send()
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "create hub error"})
	}
	h.zeroHub.AddHub(hub)

	return h.Response(ctx, fasthttp.StatusOK, hub)
}
