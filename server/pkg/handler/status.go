package handler

import (
	"github.com/valyala/fasthttp"
)

func (h *handler) Status(ctx *fasthttp.RequestCtx) error {
	ctx.Response.Header.SetBytesV("Access-Control-Allow-Origin", ctx.Request.Header.Peek("Origin"))

	if h.mg.IsMigrating() {
		return h.Response(ctx, fasthttp.StatusOK, map[string]string{"status": "migrating", "backupHost": h.mg.GetBackupHost()})
	}

	return h.Response(ctx, fasthttp.StatusOK, map[string]string{"status": "ok"})
}
