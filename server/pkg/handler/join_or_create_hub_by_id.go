package handler

import (
	hub "github.com/hotcode-dev/zerohub/pkg/hub"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// JoinOrCreateHubByID joins an existing hub with the given ID or creates a new one if it does not exist.
// The get-or-create is atomic at the ZeroHub layer, so concurrent join-or-create
// calls for the same ID always land in the same hub.
func (h *handler) JoinOrCreateHubByID(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub, hubId string) error {
	// Static callers pass the `id` param verbatim; IP-hub callers pass a
	// generated FNV hash. The shared validation helper rejects an
	// empty/whitespace id and oversized params before any hub state is
	// touched, and answers an oversized hubMetadata with 413 before its
	// JSON shape is checked (the DoS guard).
	if h.validateHubCreateParams(ctx, hubId) {
		return nil
	}

	// The cross-mode collision claim is atomic under h.hubIdCrossModeMu:
	// probe every sibling hub mode for an existing holder of this user-
	// chosen id, then run GetOrCreateHub — all while holding the lock, so
	// a join-or-create that would create a new hub can't race a create in
	// another mode into fragmenting the room under one public id. IP-hub
	// callers pass an FNV hash, which no sibling holds, so the probe is a
	// no-op there.
	newHub, created, err, rejected := h.claimGetOrCreateHub(ctx, hubId, h.siblingInstances(zh),
		func() (hub.Hub, bool, error) {
			return zh.GetOrCreateHub(hubId, string(ctx.QueryArgs().Peek("hubMetadata")), false)
		})
	if rejected {
		// A sibling mode already holds this id; the claim wrote the 409
		// Conflict, so stop without overwriting it.
		return nil
	}
	if err != nil {
		log.Error().Err(err).Send()
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "create hub error"})
	}

	if err, responseWritten := h.Upgrade(ctx, zh, newHub); err != nil || responseWritten {
		return h.finishUpgradeFailure(ctx, err, responseWritten,
			func() {
				if created {
					zh.RemoveHubById(newHub.GetId())
				}
			})
	}

	return nil
}
