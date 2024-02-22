package handler

import (
	"github.com/valyala/fasthttp"
)

func (h *handler) JoinHub(ctx *fasthttp.RequestCtx) error {
	if h.mg.IsMigrating() && h.mg.IsMigratingHubID(string(ctx.QueryArgs().Peek("id"))) {
		return h.Forward(ctx)
	}

	hub := h.zh.GetHubByID(string(ctx.QueryArgs().Peek("id")))
	if hub == nil {
		ctx.Error("hub not found", fasthttp.StatusNotFound)
		return nil
	}

	return h.Upgrade(ctx, hub)
}
