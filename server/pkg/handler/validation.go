package handler

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/hotcode-dev/zerohub/pkg/config"
	hub "github.com/hotcode-dev/zerohub/pkg/hub"
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
// the claimUserChosenHubId and Upgrade(responseWritten) idioms
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

// claimUserChosenHubId atomically claims a user-chosen hub id across the
// hub modes: it probes every sibling instance for an existing holder and,
// if the id is free in all of them, runs create — all under
// h.hubIdCrossModeMu. Each hub mode keeps its own storage behind its own
// lock, so a same-mode create is atomic on its own — but the cross-mode
// probe by itself is an unlocked read. Without the handler-level lock, two
// concurrent requests that each create the same user-chosen id in two
// different modes can both pass the probe (neither sibling holds the id
// yet) and both store, fragmenting the room under one public id. Running
// create while the lock is still held makes the check-and-store mutually
// exclusive across modes. The caller's own instance is not among the
// siblings: it is where create lands, and a same-mode duplicate is caught
// by the atomic create primitive (ErrHubAlreadyExists → 409).
//
// When a sibling already holds the id it writes a 409 Conflict and returns
// rejected=true — the caller must stop. create's error (including a
// same-mode ErrHubAlreadyExists) is passed through with rejected=false.
// A nil sibling holds no hubs and is skipped, keeping the guard usable
// from call sites that only have some of the sibling instances.
func (h *handler) claimUserChosenHubId(ctx *fasthttp.RequestCtx, hubId string, siblings []zerohub.ZeroHub, create func() (hub.Hub, error)) (newHub hub.Hub, err error, rejected bool) {
	h.hubIdCrossModeMu.Lock()
	defer h.hubIdCrossModeMu.Unlock()
	for _, instance := range siblings {
		if instance == nil {
			continue
		}
		if instance.GetHubById(hubId) != nil {
			log.Error().Err(fmt.Errorf("hub with id %s already exists in another hub type", hubId)).Send()
			// Response writes the 409 body; a marshal failure here is
			// impossible for a static map[string]string body.
			h.Response(ctx, fasthttp.StatusConflict, map[string]string{"error": "hub id collides with another hub type"})
			return nil, nil, true
		}
	}
	newHub, err = create()
	return newHub, err, false
}

// claimGetOrCreateHub is the GetOrCreateHub twin of claimUserChosenHubId:
// it atomically probes every sibling instance for an existing holder of the
// id and, if the id is free in all of them, runs getOrCreate — all under
// h.hubIdCrossModeMu — so a join-or-create that would mint a new hub can't
// race a create in another mode into storing two hubs under one public id.
// The 409/rejected contract matches claimUserChosenHubId.
func (h *handler) claimGetOrCreateHub(ctx *fasthttp.RequestCtx, hubId string, siblings []zerohub.ZeroHub, getOrCreate func() (hub.Hub, bool, error)) (newHub hub.Hub, created bool, err error, rejected bool) {
	h.hubIdCrossModeMu.Lock()
	defer h.hubIdCrossModeMu.Unlock()
	for _, instance := range siblings {
		if instance == nil {
			continue
		}
		if instance.GetHubById(hubId) != nil {
			log.Error().Err(fmt.Errorf("hub with id %s already exists in another hub type", hubId)).Send()
			h.Response(ctx, fasthttp.StatusConflict, map[string]string{"error": "hub id collides with another hub type"})
			return nil, false, nil, true
		}
	}
	newHub, created, err = getOrCreate()
	return newHub, created, err, false
}

// siblingInstances returns every hub-mode instance the handler owns except
// self — the set of storages that could already hold a user-chosen hub id,
// and therefore the set the claim* helpers probe. A nil instance holds no
// hubs and is skipped, which keeps the helpers usable from call sites (and
// tests) where only some of the instances are present. Excluding self
// avoids a self-probe that would 409 its own just-created hub; same-mode
// duplicates are already caught atomically by the create primitive.
func (h *handler) siblingInstances(self zerohub.ZeroHub) []zerohub.ZeroHub {
	siblings := []zerohub.ZeroHub{}
	for _, instance := range []zerohub.ZeroHub{h.zeroHubStatic, h.zeroHubRandom, h.zeroHubIP} {
		if instance == nil || instance == self {
			continue
		}
		siblings = append(siblings, instance)
	}
	return siblings
}
