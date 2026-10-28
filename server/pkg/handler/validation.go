package handler

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/hotcode-dev/zerohub/pkg/config"
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

// validMetadataSize reports whether a raw `id`/`hubMetadata`/`peerMetadata`
// query parameter value is within the application's size cap (config.
// MaxMetadataSize). These values are stored in hub/peer state and
// re-broadcast to every peer in the hub, so the cap must be enforced before
// any state is touched: an oversized value would otherwise be amplified
// O(N) across the hub. fasthttp bounds the whole request head (URL plus
// all headers) via ReadBufferSize — default 4kb, 431 on overflow — not
// individual parameters, and that is a transport default rather than an
// intentional application guard.
func validMetadataSize(raw string, max int) bool {
	return len(raw) <= max
}

// rejectOversizedParam writes the 413 for a query parameter that exceeds
// the size cap. It reuses Response (which returns nil on success) so the
// caller's 503 error fallback in Serve cannot overwrite the 413 body.
func (h *handler) rejectOversizedParam(ctx *fasthttp.RequestCtx, param string, max int) error {
	return h.Response(ctx, fasthttp.StatusRequestEntityTooLarge,
		map[string]string{"error": param + " query parameter exceeds the maximum size of " + strconv.Itoa(max) + " bytes"})
}

// validJSONQueryParam reports whether the given query parameter (when
// present) is valid JSON. The client SDK only ever sends stringified JSON,
// so anything else is rejected up front: malformed metadata would otherwise
// be stored on the hub/peer and re-broadcast to every peer, where a naive
// client that JSON.parses it would crash its message dispatcher.
func validJSONQueryParam(ctx *fasthttp.RequestCtx, param string) bool {
	raw := string(ctx.QueryArgs().Peek(param))
	if raw == "" {
		return true
	}
	return json.Valid([]byte(raw))
}

// rejectInvalidJSONParam writes the 400 for a malformed JSON query
// parameter. It reuses Response (which returns nil on success) so the
// caller's 503 error fallback cannot overwrite the 400 body.
func (h *handler) rejectInvalidJSONParam(ctx *fasthttp.RequestCtx, param string) error {
	return h.Response(ctx, fasthttp.StatusBadRequest,
		map[string]string{"error": "invalid " + param + " query parameter: must be JSON"})
}

// validateHubCreateParams runs the ordered hub-parameter validation shared
// by every create / join-or-create endpoint (static + random creates,
// static + IP join-or-create, and the admin permanent create): empty/
// whitespace id (400), oversized id (413), oversized hubMetadata (413),
// malformed hubMetadata JSON (400). It returns true — having already written
// the 4xx rejection — when any check fails, so the caller must stop; false
// when all checks pass.
//
// It returns bool, not an error, because each rejection is written via the
// shared reject* helpers, which write the response and return nil so the
// caller's 503 fallback in Serve cannot overwrite the written body — a
// non-nil error would propagate to Serve and clobber the 4xx. This matches
// the rejectHubIdCollidesWithOtherModes and Upgrade(responseWritten) idioms
// already in this package.
//
// The ordering is intentional: the 400 for a missing id wins over any 413
// or 409, and an empty/whitespace id must not reach hub state, where it
// would silently create/join a hub under the empty-string key and squat
// that key forever. Generated ids (uuid for random hubs, xxh3 hash for IP
// hubs) are never empty and far under the cap, so the id checks are no-ops
// on those paths. hubMetadata is size-capped BEFORE the JSON shape check:
// it is stored and re-sent to every joiner, and the size guard answers an
// oversized blob with 413 without running json.Valid on a large payload —
// the cheaper path, and the real DoS guard.
func (h *handler) validateHubCreateParams(ctx *fasthttp.RequestCtx, hubId string) bool {
	if !validHubId(hubId) {
		_ = h.rejectInvalidHubIdParam(ctx)
		return true
	}
	if !validMetadataSize(hubId, config.MaxMetadataSize) {
		_ = h.rejectOversizedParam(ctx, "id", config.MaxMetadataSize)
		return true
	}
	if !validMetadataSize(string(ctx.QueryArgs().Peek("hubMetadata")), config.MaxMetadataSize) {
		_ = h.rejectOversizedParam(ctx, "hubMetadata", config.MaxMetadataSize)
		return true
	}
	if !validJSONQueryParam(ctx, "hubMetadata") {
		_ = h.rejectInvalidJSONParam(ctx, "hubMetadata")
		return true
	}
	return false
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
		// A nil instance holds no hubs; skipping it keeps this guard
		// usable from call sites that only have some of the sibling
		// instances.
		if instance == nil {
			continue
		}
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
