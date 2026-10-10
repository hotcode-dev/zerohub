package handler

import (
	"github.com/valyala/fasthttp"
)

// Status returns the status of the server.
//
// CORS: /v1/status is intentionally a public, read-only health/migration
// endpoint that any origin must be able to call — ZeroHub is a community
// service, and any site (community dashboards, arbitrary user pages) is
// allowed to read the migration state. The response therefore carries a
// static Access-Control-Allow-Origin: * plus Vary: Origin. The header is
// deliberately a constant, NOT a reflection of the request's Origin header:
// reflecting an arbitrary Origin is the classic "reflect any origin" CORS
// anti-pattern, and is unnecessary here since the endpoint is open to all
// origins anyway. The exposed data (status + backupHost) is considered
// public.
func (h *handler) Status(ctx *fasthttp.RequestCtx) error {
	ctx.Response.Header.Set("Access-Control-Allow-Origin", "*")
	ctx.Response.Header.Add("Vary", "Origin")

	if h.isMigrating.Load() {
		return h.Response(ctx, fasthttp.StatusMovedPermanently, map[string]string{"status": "migrating", "backupHost": h.getBackupHost()})
	}

	return h.Response(ctx, fasthttp.StatusOK, map[string]string{"status": "ok"})
}
