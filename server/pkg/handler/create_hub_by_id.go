package handler

import (
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
)

// CreateHubByID atomically creates a new hub with the given ID and upgrades
// the connection. The create goes through the atomic CreateHubIfAbsent
// primitive, so concurrent requests for the same ID never orphan a hub:
// exactly one wins and the rest get 409. Random-hub callers pass a fresh
// uuid that cannot collide, so the 409 branch is unreachable there — the
// shared path just stays safe.
func (h *Handler) CreateHubByID(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub, hubId string) error {
	// Static callers pass the `id` param verbatim; random-hub callers pass
	// a generated uuid. The shared validation helper rejects an
	// empty/whitespace id and oversized params before any hub state is
	// touched, and answers an oversized hubMetadata with 413 before its
	// JSON shape is checked (the DoS guard).
	if h.validateHubCreateParams(ctx, hubId) {
		return nil
	}

	// The cross-mode collision claim is atomic under h.hubIdCrossModeMu:
	// probe every sibling hub mode for an existing holder of this user-
	// chosen id, then run CreateHubIfAbsent — all while holding the lock,
	// so two concurrent creates of the same id in different modes can't
	// both pass the probe and both store (which would fragment the room
	// under one public id). Random-hub callers pass a fresh uuid, which no
	// sibling holds, so the probe is a no-op there.
	newHub, ok := h.claimHubForCreate(ctx, zh, hubId, false)
	if !ok {
		return nil
	}

	if err, responseWritten := h.Upgrade(ctx, zh, newHub); err != nil || responseWritten {
		return h.finishUpgradeFailure(ctx, err, responseWritten,
			func() { zh.RemoveHubById(newHub.GetId()) })
	}

	return nil
}
