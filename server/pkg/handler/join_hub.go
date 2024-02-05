package handler

import (
	"github.com/valyala/fasthttp"
)

func (h *handler) JoinHub(ctx *fasthttp.RequestCtx) error {
	hubID := string(ctx.QueryArgs().Peek("id"))
	hub := h.zh.GetHubByID(hubID)

	if hub == nil {
		ctx.Error("hub not found", fasthttp.StatusNotFound)
		return nil
	}

	return h.Upgrade(ctx, hub)
}
