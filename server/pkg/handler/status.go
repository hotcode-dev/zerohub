package handler

import (
	"github.com/valyala/fasthttp"
)

func (h *handler) Status(ctx *fasthttp.RequestCtx) error {
	ctx.Response.Header.SetBytesV("Access-Control-Allow-Origin", ctx.Request.Header.Peek("Origin"))

	if h.mg.IsMigrating() {
		ctx.SetStatusCode(fasthttp.StatusMovedPermanently)
		ctx.SetBody([]byte(h.mg.GetNewReleaseHost()))

		return nil
	}

	ctx.SetStatusCode(fasthttp.StatusOK)

	return nil
}
