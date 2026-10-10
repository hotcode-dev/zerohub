package handler

import (
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// JoinHub joins an existing hub with the given ID.
func (h *handler) JoinHub(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error {
	hubId := string(ctx.QueryArgs().Peek("id"))
	// Reject a missing/empty ID up front with 400 for consistency: before
	// this, such a request degraded to 404 (or a migration forward).
	if !validHubId(hubId) {
		return h.rejectInvalidHubIdParam(ctx)
	}

	hub := zh.GetHubById(hubId)
	if hub == nil {
		// If the hub does not exist, we will try to send to the backup host
		if h.isMigrating.Load() {
			return h.ForwardMigrate(ctx)
		}

		return h.Response(ctx, fasthttp.StatusNotFound, map[string]string{"error": "hub not found"})
	}

	if err := h.Upgrade(ctx, zh, hub); err != nil {
		log.Error().Err(fmt.Errorf("websocket upgrade error: %w", err)).Send()
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "websocket upgrade error"})
	}

	return nil
}
