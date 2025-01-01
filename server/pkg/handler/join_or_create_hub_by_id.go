package handler

import (
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

func (h *handler) JoinOrCreateHubByID(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub, hubId string) error {
	newHub := zh.GetHubById(hubId)
	if h == nil {
		// create a new hub if it does not exist
		hub, err := zh.NewHub(hubId, string(ctx.QueryArgs().Peek("hubMetadata")), false)
		if err != nil {
			log.Error().Err(err).Send()
			return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "create hub error"})
		}
		newHub = hub
	}

	if err := h.Upgrade(ctx, zh, newHub); err != nil {
		log.Error().Err(fmt.Errorf("websocket upgrade error: %w", err)).Send()
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "websocket upgrade error"})
	}

	return nil
}
