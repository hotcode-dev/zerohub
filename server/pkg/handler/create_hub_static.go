package handler

import (
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
)

// CreateHubStatic creates a new hub with a static ID. The check-then-create
// is atomic inside CreateHubByID (via CreateHubIfAbsent), so concurrent
// creates of the same ID collapse to one 409 instead of orphaning a hub.
func (h *handler) CreateHubStatic(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error {
	if h.isMigrating.Load() {
		return h.ForwardMigrate(ctx)
	}

	hubId := string(ctx.QueryArgs().Peek("id"))
	// Same ordering as CreateHubPermanent: the 400 for a missing/empty id
	// wins over the 409 for a colliding id, and no hub-state access may
	// happen for an invalid id.
	if !validHubId(hubId) {
		return h.rejectInvalidHubIdParam(ctx)
	}
	// Cross-mode collision guard: reject an ID already held by the
	// permanent (or random) instance with 409 instead of silently minting
	// a second hub under the same id.
	if h.rejectHubIdCollidesWithOtherModes(ctx, hubId, h.zeroHubPermanent, h.zeroHubRandom) {
		return nil
	}

	return h.CreateHubByID(ctx, zh, hubId)
}
