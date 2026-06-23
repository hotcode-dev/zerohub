package handler

import (
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// JoinOrCreateHubByID joins an existing hub with the given ID or creates a new one if it does not exist.
func (h *handler) JoinOrCreateHubByID(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub, hubId string) error {
	isNew := false
	newHub := zh.GetHubById(hubId)
	if newHub == nil {
		// create a new hub if it does not exist
		hub, err := zh.NewHub(hubId, string(ctx.QueryArgs().Peek("hubMetadata")), false)
		if err != nil {
			log.Error().Err(err).Str("hubId", hubId).Str("path", string(ctx.Path())).Msg("failed to create hub")
			return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "create hub error"})
		}
		newHub = hub
		isNew = true
	}

	if err := h.Upgrade(ctx, zh, newHub); err != nil {
		log.Error().Err(err).Str("hubId", hubId).Str("path", string(ctx.Path())).Msg("websocket upgrade failed")
		// remove hub if we created it and upgrade failed
		if isNew {
			if removeErr := zh.RemoveHubById(hubId); removeErr != nil {
				log.Error().Err(removeErr).Str("hubId", hubId).Msg("failed to remove hub after upgrade error")
			}
		}
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "websocket upgrade error"})
	}

	return nil
}
