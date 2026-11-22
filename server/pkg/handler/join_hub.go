package handler

import (
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
)

// JoinHub joins an existing hub with the given ID.
func (h *Handler) JoinHub(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error {
	hubId := string(ctx.QueryArgs().Peek("id"))
	// Reject a missing/empty or oversized ID up front with 400/413 for
	// consistency: before this, a missing id degraded to 404 (or a
	// migration forward), and an oversized user-chosen id would have been
	// rejected at creation.
	if h.validateHubIdParam(ctx, hubId) {
		return nil
	}

	hub := zh.GetHubById(hubId)
	if hub == nil {
		// If the hub does not exist, we will try to send to the backup host
		if h.isMigrating.Load() {
			return h.ForwardMigrate(ctx)
		}

		return h.Response(ctx, fasthttp.StatusNotFound, map[string]string{"error": "hub not found"})
	}

	if err, responseWritten := h.Upgrade(ctx, zh, hub); err != nil || responseWritten {
		return h.finishUpgradeFailure(ctx, err, responseWritten, nil)
	}

	return nil
}
