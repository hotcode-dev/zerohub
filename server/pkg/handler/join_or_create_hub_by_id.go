package handler

import (
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/config"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// JoinOrCreateHubByID joins an existing hub with the given ID or creates a new one if it does not exist.
// The get-or-create is atomic at the ZeroHub layer, so concurrent join-or-create
// calls for the same ID always land in the same hub.
func (h *handler) JoinOrCreateHubByID(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub, hubId string) error {
	// Static callers pass the `id` param verbatim; an empty/whitespace ID
	// would otherwise join-or-create a hub under the empty-string key.
	// IP-hub callers pass an xxh3 hash, which is never empty, so this is a
	// no-op there.
	if !validHubId(hubId) {
		return h.rejectInvalidHubIdParam(ctx)
	}
	// An oversized id is rejected before the hub id is used as a storage
	// key: it would otherwise be stored and re-sent on every hub-info
	// broadcast. IP-hub ids are 20-digit decimal hashes, far under the
	// cap, so this is a no-op there.
	if !validMetadataSize(hubId, config.MaxMetadataSize) {
		return h.rejectOversizedParam(ctx, "id", config.MaxMetadataSize)
	}
	// The hub metadata is stored and re-sent to every joiner, so it must be
	// size-capped before it reaches hub state. Size runs before the JSON
	// shape check so an oversized value is answered 413 without running
	// json.Valid on a large blob — the cheaper path, and the real DoS guard.
	if !validMetadataSize(string(ctx.QueryArgs().Peek("hubMetadata")), config.MaxMetadataSize) {
		return h.rejectOversizedParam(ctx, "hubMetadata", config.MaxMetadataSize)
	}
	if !validJSONQueryParam(ctx, "hubMetadata") {
		return h.rejectInvalidJSONParam(ctx, "hubMetadata")
	}

	newHub, created, err := zh.GetOrCreateHub(hubId, string(ctx.QueryArgs().Peek("hubMetadata")), false)
	if err != nil {
		log.Error().Err(err).Send()
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "create hub error"})
	}

	if err, responseWritten := h.Upgrade(ctx, zh, newHub); err != nil || responseWritten {
		// AddPeer only runs inside the upgrade callback, so whenever the
		// upgrade does not fully succeed — a real handshake error, or the
		// up-front peerMetadata rejection that already wrote a 400 — this
		// request never added a peer. Remove the hub only when this call
		// created it: a pre-existing hub may hold live peers and must be
		// left in place.
		if created {
			zh.RemoveHubById(newHub.GetId())
		}
		if err != nil {
			log.Error().Err(fmt.Errorf("websocket upgrade error: %w", err)).Send()
		}
		// The up-front peerMetadata rejection already wrote a 400; do not
		// overwrite it with a 500.
		if responseWritten {
			return nil
		}
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "websocket upgrade error"})
	}

	return nil
}
