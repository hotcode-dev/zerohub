package handler

import (
	"errors"
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// CreateHubByID atomically creates a new hub with the given ID and upgrades
// the connection. The create goes through the atomic CreateHubIfAbsent
// primitive, so concurrent requests for the same ID never orphan a hub:
// exactly one wins and the rest get 409. Random-hub callers pass a fresh
// uuid that cannot collide, so the 409 branch is unreachable there — the
// shared path just stays safe.
func (h *handler) CreateHubByID(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub, hubId string) error {
	newHub, err := zh.CreateHubIfAbsent(hubId, string(ctx.QueryArgs().Peek("hubMetadata")), false)
	if err != nil {
		if errors.Is(err, zerohub.ErrHubAlreadyExists) {
			log.Error().Err(fmt.Errorf("hub with id %s already exists", hubId)).Send()
			return h.Response(ctx, fasthttp.StatusConflict, map[string]string{"error": "hub id already exists"})
		}
		log.Error().Err(err).Send()
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "create hub error"})
	}

	if err := h.Upgrade(ctx, zh, newHub); err != nil {
		// remove the hub if the upgrade failed
		zh.RemoveHubById(newHub.GetId())
		log.Error().Err(fmt.Errorf("websocket upgrade error: %w", err)).Send()
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "websocket upgrade error"})
	}

	return nil
}
