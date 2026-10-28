package handler

import (
	"errors"
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// CreateHubByID atomically creates a new hub with the given ID and upgrades
// the connection. The create goes through the atomic CreateHubIfAbsent
// primitive, so concurrent requests for the same ID never orphan a hub:
// exactly one wins and the rest get 409. Random-hub callers pass a fresh
// uuid that cannot collide, so the 409 branch is unreachable there — the
// shared path just stays safe.
func (h *handler) CreateHubByID(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub, hubId string) error {
	// Static callers pass the `id` param verbatim; random-hub callers pass
	// a generated uuid. The shared validation helper rejects an
	// empty/whitespace id and oversized params before any hub state is
	// touched, and answers an oversized hubMetadata with 413 before its
	// JSON shape is checked (the DoS guard).
	if h.validateHubCreateParams(ctx, hubId) {
		return nil
	}

	newHub, err := zh.CreateHubIfAbsent(hubId, string(ctx.QueryArgs().Peek("hubMetadata")), false)
	if err != nil {
		if errors.Is(err, zerohub.ErrHubAlreadyExists) {
			log.Error().Err(fmt.Errorf("hub with id %s already exists", hubId)).Send()
			return h.Response(ctx, fasthttp.StatusConflict, map[string]string{"error": "hub id already exists"})
		}
		log.Error().Err(err).Send()
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "create hub error"})
	}

	if err, responseWritten := h.Upgrade(ctx, zh, newHub); err != nil || responseWritten {
		// remove the hub if the upgrade failed — including the up-front
		// peerMetadata rejection, which returns a pre-written 400 instead of
		// an error
		zh.RemoveHubById(newHub.GetId())
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
