package handler

import (
	"fmt"

	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

func (h *handler) GetHub(ctx *fasthttp.RequestCtx) error {
	hubId := string(ctx.QueryArgs().Peek("id"))

	hub := h.zh.GetHubById(hubId)
	if hub == nil {
		log.Error().Err(fmt.Errorf("hub with id %s not found", hubId)).Send()
		return h.Response(ctx, fasthttp.StatusNotFound, map[string]string{"error": "hub not found"})
	}

	return h.Response(ctx, fasthttp.StatusOK, hub)
}
