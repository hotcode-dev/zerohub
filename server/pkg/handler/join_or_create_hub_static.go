package handler

import (
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
)

// JoinOrCreateHubStatic joins or creates a hub with a static ID.
func (h *handler) JoinOrCreateHubStatic(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error {
	if h.isMigrating.Load() {
		return h.ForwardMigrate(ctx)
	}

	hubId := string(ctx.QueryArgs().Peek("id"))
	// Cross-mode collision guard: reject an ID already held by the
	// permanent (or random) instance with 409 instead of silently minting
	// a second hub under the same id. An empty/whitespace id is rejected
	// with 400 by JoinOrCreateHubByID's shared validation before hub
	// resolution, so this guard never sees an invalid id.
	if h.rejectHubIdCollidesWithOtherModes(ctx, hubId, h.zeroHubPermanent, h.zeroHubRandom) {
		return nil
	}

	return h.JoinOrCreateHubByID(ctx, zh, hubId)
}
