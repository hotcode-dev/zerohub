package handler

import (
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/config"
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
	// A user-chosen id over the size cap would have been rejected at
	// creation; rejecting it here keeps the read path consistent with the
	// write path.
	if !validMetadataSize(hubId, config.MaxMetadataSize) {
		return h.rejectOversizedParam(ctx, "id", config.MaxMetadataSize)
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
