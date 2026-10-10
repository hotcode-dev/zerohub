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
func (h *handler) CreateHubPermanent(ctx *fasthttp.RequestCtx) error {
	if h.isMigrating.Load() {
		return h.ForwardMigrate(ctx)
	}

	if err := h.CheckAdminAuth(ctx); err != nil {
		return err
	}

	hubId := string(ctx.QueryArgs().Peek("id"))
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
