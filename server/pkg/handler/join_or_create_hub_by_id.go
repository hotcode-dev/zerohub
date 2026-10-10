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
	// Static callers pass the `id` param verbatim; an empty/whitespace ID
	// would otherwise join-or-create a hub under the empty-string key.
	// IP-hub callers pass an xxh3 hash, which is never empty, so this is a
	// no-op there.
	if !validHubId(hubId) {
		return h.rejectInvalidHubIdParam(ctx)
	}
	if !validJSONQueryParam(ctx, "hubMetadata") {
		return h.rejectInvalidJSONParam(ctx, "hubMetadata")
	}

	newHub, err := zh.GetOrCreateHub(hubId, string(ctx.QueryArgs().Peek("hubMetadata")), false)
	if err != nil {
		log.Error().Err(err).Send()
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "create hub error"})
	}

	if err := h.Upgrade(ctx, zh, newHub); err != nil {
		log.Error().Err(fmt.Errorf("websocket upgrade error: %w", err)).Send()
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "websocket upgrade error"})
	}

	return nil
}
