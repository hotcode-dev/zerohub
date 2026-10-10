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
	if h.isMigrating.Load() {
		return h.ForwardMigrate(ctx)
	}

	if err := h.CheckAdminAuth(ctx); err != nil {
		return err
	}

	hubId := string(ctx.QueryArgs().Peek("id"))
	// Auth runs first (401 for unauthenticated requests wins over 400 for
	// a bad id), then the ID is validated before any hub-state access.
	if !validHubId(hubId) {
		return h.rejectInvalidHubIdParam(ctx)
	}
	if !validJSONQueryParam(ctx, "hubMetadata") {
		return h.rejectInvalidJSONParam(ctx, "hubMetadata")
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
