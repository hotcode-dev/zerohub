package handler

import (
	"errors"
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// CreateHubPermanent creates a new permanent hub.
// It requires admin authentication.
// The create goes through the atomic CreateHubIfAbsent primitive, so
// concurrent requests for the same ID never orphan a hub: exactly one wins
// and the rest get 409.
func (h *handler) CreateHubPermanent(ctx *fasthttp.RequestCtx) error {
	// Auth runs before the migration check so an unauthenticated request is
	// answered with 401 instead of a WebSocket close whose reason is the
	// internal backup host. No state is mutated between the two checks, so
	// this ordering is safe.
	if err := h.CheckAdminAuth(ctx); err != nil {
		return err
	}

	// This endpoint is plain HTTP, not a WebSocket signaling channel: it does
	// not upgrade the connection, so ForwardMigrate (which requires a
	// WebSocket handshake) would surface a 503 "websocket handshake" to an
	// out-of-band HTTP create. Reject it with the same HTTP-level migration
	// response Status returns — a 301 carrying the backup host. No hub is
	// created while migrating.
	if h.isMigrating.Load() {
		return h.migrateHTTPResponse(ctx)
	}

	hubId := string(ctx.QueryArgs().Peek("id"))
	// The 401 for unauthenticated requests wins over 400 for a bad id, then
	// the ID is validated before any hub-state access.
	if !validHubId(hubId) {
		return h.rejectInvalidHubIdParam(ctx)
	}
	if !validJSONQueryParam(ctx, "hubMetadata") {
		return h.rejectInvalidJSONParam(ctx, "hubMetadata")
	}

	// Cross-mode collision guard: each hub mode keeps its own storage, so
	// without this check a permanent create would silently mint a second
	// hub with an id already held by the static or random instance,
	// fragmenting the room under one public id. IP hubs are excluded:
	// their ids are derived from the client IP and cannot collide with a
	// user-chosen id.
	if h.zeroHub.GetHubById(hubId) != nil || h.zeroHubRandom.GetHubById(hubId) != nil {
		log.Error().Err(fmt.Errorf("hub with id %s already exists in another hub type", hubId)).Send()
		return h.Response(ctx, fasthttp.StatusConflict, map[string]string{"error": "hub id collides with another hub type"})
	}

	newHub, err := h.zeroHubPermanent.CreateHubIfAbsent(hubId, string(ctx.QueryArgs().Peek("hubMetadata")), true)
	if err != nil {
		if errors.Is(err, zerohub.ErrHubAlreadyExists) {
			log.Error().Err(fmt.Errorf("hub with id %s already exists", hubId)).Send()
			return h.Response(ctx, fasthttp.StatusConflict, map[string]string{"error": "hub id already exists"})
		}
		log.Error().Err(err).Send()
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "create hub error"})
	}

	return h.Response(ctx, fasthttp.StatusOK, newHub)
}
