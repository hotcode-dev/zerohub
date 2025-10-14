package handler

import (
	"github.com/valyala/fasthttp"
)

// Status returns the status of the server.
func (h *handler) Status(ctx *fasthttp.RequestCtx) error {
	ctx.Response.Header.SetBytesV("Access-Control-Allow-Origin", ctx.Request.Header.Peek("Origin"))

	if h.isMigrating {
		return h.Response(ctx, fasthttp.StatusMovedPermanently, map[string]string{"status": "migrating", "backupHost": h.backupHost})
	}

	return h.Response(ctx, fasthttp.StatusOK, map[string]string{"status": "ok"})
}
