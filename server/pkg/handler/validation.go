package handler

import (
	"fmt"
	"strings"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// validHubId reports whether a hub ID is usable: non-empty and not
// whitespace-only. Callers of the shared by-ID helpers pass either the
// static ID read verbatim from the `id` query parameter or a
// server-generated ID (uuid for random hubs, xxh3 hash for IP hubs) — the
// latter are never empty, so this check is a no-op for those paths.
// Rejecting an empty ID up front stops a request with a missing/empty `id`
// from silently creating a hub under the empty-string key, which would
// squat that key forever (every later empty-id create gets 409, and any
// join without `id` lands in that junk hub instead of a clean 404).
func validHubId(hubId string) bool {
	return strings.TrimSpace(hubId) != ""
}

// rejectInvalidHubIdParam writes the 400 for a missing/empty `id` query
// parameter. It reuses Response (which returns nil on success) so the
// caller's 503 error fallback in Serve cannot overwrite the 400 body.
func (h *handler) rejectInvalidHubIdParam(ctx *fasthttp.RequestCtx) error {
	return h.Response(ctx, fasthttp.StatusBadRequest,
		map[string]string{"error": "id query parameter is required"})
}

// rejectHubIdCollidesWithOtherModes applies the cross-mode collision guard
// to user-chosen hub IDs: each hub mode keeps its own storage, so without
// this check a create would silently mint a second hub with an id already
// held by another mode's instance, fragmenting the room under one public
// id. It probes the given sibling instances (the caller's own storage is
// the one the create will land in, so it is not passed here). IP hubs are
// never probed: their ids are derived from the client IP and cannot
// collide with a user-chosen id.
//
// It returns true — having already written the 409 Conflict to the
// response — when the id is held in one of the probed instances, so the
// caller must stop; false when the id is free in all of them.
func (h *handler) rejectHubIdCollidesWithOtherModes(ctx *fasthttp.RequestCtx, hubId string, instances ...zerohub.ZeroHub) bool {
	for _, instance := range instances {
		if instance.GetHubById(hubId) != nil {
			log.Error().Err(fmt.Errorf("hub with id %s already exists in another hub type", hubId)).Send()
			// Response writes the 409 body; a marshal failure here is
			// impossible for a static map[string]string body.
			h.Response(ctx, fasthttp.StatusConflict, map[string]string{"error": "hub id collides with another hub type"})
			return true
		}
	}
	return false
}
