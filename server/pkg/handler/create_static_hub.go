package handler

import (
	"errors"
	"fmt"

	hub "github.com/hotcode-dev/zerohub/pkg/hub"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// CreateStaticHub creates a new static hub. It requires admin
// authentication.
//
// A static hub never expires: it is created out-of-band by an admin over
// plain HTTP and joined via WebSocket (GET /v1/static-hubs/join). The
// create goes through the atomic CreateHubIfAbsent primitive, so
// concurrent requests for the same ID never orphan a hub: exactly one wins
// and the rest get 409.
func (h *handler) CreateStaticHub(ctx *fasthttp.RequestCtx) error {
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
	// The 401 for unauthenticated requests wins over the 400 for a bad id:
	// auth ran above. The shared validation helper then rejects an
	// empty/whitespace id and oversized params before any hub-state access
	// (including the cross-mode collision guard), answering an oversized
	// hubMetadata with 413 before its JSON shape is checked.
	if h.validateHubCreateParams(ctx, hubId) {
		return nil
	}

	// Cross-mode collision guard: each hub mode keeps its own storage, so
	// without this check a static create would silently mint a second hub
	// with an id already held by another mode, fragmenting the room under
	// one public id. The claim is atomic under h.hubIdCrossModeMu — probe
	// the sibling instances and run CreateHubIfAbsent all while holding
	// the lock — so a concurrent create of the same id in another mode
	// can't interleave between the probe and the store.
	newHub, err, rejected := h.claimUserChosenHubId(ctx, hubId, h.siblingInstances(h.zeroHubStatic),
		func() (hub.Hub, error) {
			return h.zeroHubStatic.CreateHubIfAbsent(hubId, string(ctx.QueryArgs().Peek("hubMetadata")), true)
		})
	if rejected {
		// A sibling mode already holds this id; claimUserChosenHubId
		// wrote the 409 Conflict, so stop without overwriting it.
		return nil
	}
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
