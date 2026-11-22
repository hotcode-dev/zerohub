package handler

import (
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// GetHub returns the hub with the given ID.
func (h *Handler) GetHub(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error {
	hubId := string(ctx.QueryArgs().Peek("id"))
	// Reject a missing/empty or oversized ID up front with 400/413 for
	// consistency with the other hub endpoints: a user-chosen id over the
	// size cap would have been rejected at creation.
	if h.validateHubIdParam(ctx, hubId) {
		return nil
	}

	// This endpoint is plain HTTP (JSON), not a WebSocket signaling channel,
	// so it forwards with the HTTP-level migration response — a 301 carrying
	// the backup host. ForwardMigrate would attempt a websocket upgrade and
	// surface a 503 "websocket handshake" to a plain-HTTP client. No hub
	// state is read while migrating; clients must move to the backup host.
	if h.isMigrating.Load() {
		return h.migrateHTTPResponse(ctx)
	}

	hub := zh.GetHubById(hubId)
	if hub == nil {
		log.Error().Err(fmt.Errorf("hub with id %s not found", hubId)).Send()
		return h.Response(ctx, fasthttp.StatusNotFound, map[string]string{"error": "hub not found"})
	}

	return h.Response(ctx, fasthttp.StatusOK, hub)
}
