package handler

import (
	"github.com/valyala/fasthttp"
)

func (h *handler) JoinHub(ctx *fasthttp.RequestCtx) error {
	hub := h.zh.GetHubById(string(ctx.QueryArgs().Peek("id")))
	if hub == nil {
		if h.mg.IsMigrating() {
			return h.ForwardMigrate(ctx)
		}
		ctx.Error("hub not found", fasthttp.StatusNotFound)
		return nil
	}

	return h.Upgrade(ctx, hub)
}
