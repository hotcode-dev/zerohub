package handler

import (
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// JoinOrCreateHubByID joins an existing hub with the given ID or creates a new one if it does not exist.
// The get-or-create is atomic at the ZeroHub layer, so concurrent join-or-create
// calls for the same ID always land in the same hub.
func (h *handler) JoinOrCreateHubByID(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub, hubId string) error {
	// Static callers pass the `id` param verbatim; IP-hub callers pass a
	// generated xxh3 hash. The shared validation helper rejects an
	// empty/whitespace id and oversized params before any hub state is
	// touched, and answers an oversized hubMetadata with 413 before its
	// JSON shape is checked (the DoS guard).
	if h.validateHubCreateParams(ctx, hubId) {
		return nil
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
