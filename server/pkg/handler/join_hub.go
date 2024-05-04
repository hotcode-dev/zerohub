package handler

import (
	"fmt"

	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

func (h *handler) JoinHub(ctx *fasthttp.RequestCtx) error {
	hub := h.zh.GetHubById(string(ctx.QueryArgs().Peek("id")))
	if hub == nil {
		log.Error().Err(fmt.Errorf("hub not found")).Send()
		return h.Response(ctx, fasthttp.StatusNotFound, map[string]string{"error": "hub not found"})
	}

	return h.Upgrade(ctx, hub)
}
