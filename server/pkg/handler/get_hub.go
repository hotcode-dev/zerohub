package handler

import (
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// GetHub returns the hub with the given ID.
func (h *handler) GetHub(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error {
	hubId := string(ctx.QueryArgs().Peek("id"))
	// Reject a missing/empty ID up front with 400 for consistency with the
	// other hub endpoints.
	if !validHubId(hubId) {
		return h.rejectInvalidHubIdParam(ctx)
	}

	hub := zh.GetHubById(hubId)
	if hub == nil {
		log.Error().Err(fmt.Errorf("hub with id %s not found", hubId)).Send()
		return h.Response(ctx, fasthttp.StatusNotFound, map[string]string{"error": "hub not found"})
	}

	return h.Response(ctx, fasthttp.StatusOK, hub)
}
