package handler

import (
	"fmt"

	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// CreateHubPermanent creates a new permanent hub.
// It requires admin authentication.
func (h *handler) CreateHubPermanent(ctx *fasthttp.RequestCtx) error {
	if h.isMigrating.Load() {
		return h.ForwardMigrate(ctx)
	}

	hubId := string(ctx.QueryArgs().Peek("id"))
	if h.zeroHubPermanent.GetHubById(hubId) != nil {
		log.Error().Err(fmt.Errorf("hub with id %s already exists", hubId)).Str("path", string(ctx.Path())).Send()
		return h.Response(ctx, fasthttp.StatusConflict, map[string]string{"error": "hub id already exists"})
	}

	newHub, err := h.zeroHubPermanent.NewHub(hubId, string(ctx.QueryArgs().Peek("hubMetadata")), true)
	if err != nil {
		log.Error().Err(err).Str("hubId", hubId).Str("path", string(ctx.Path())).Msg("failed to create permanent hub")
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "create hub error"})
	}

	return h.Response(ctx, fasthttp.StatusOK, newHub)
}
