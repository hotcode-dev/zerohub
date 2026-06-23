package handler

import (
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// CreateHubByID creates a new hub with the given ID.
func (h *handler) CreateHubByID(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub, hubId string) error {
	newHub, err := zh.NewHub(hubId, string(ctx.QueryArgs().Peek("hubMetadata")), false)
	if err != nil {
		log.Error().Err(err).Str("hubId", hubId).Str("path", string(ctx.Path())).Msg("failed to create hub")
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "create hub error"})
	}

	if err := h.Upgrade(ctx, zh, newHub); err != nil {
		log.Error().Err(err).Str("hubId", newHub.GetId()).Str("path", string(ctx.Path())).Msg("websocket upgrade failed, removing hub")
		// remove the hub if the upgrade failed
		if removeErr := zh.RemoveHubById(newHub.GetId()); removeErr != nil {
			log.Error().
				Err(removeErr).
				Err(fmt.Errorf("websocket upgrade error: %w", err)).
				Str("hubId", newHub.GetId()).
				Msg("failed to remove hub after upgrade error")
		}
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "websocket upgrade error"})
	}

	return nil
}
