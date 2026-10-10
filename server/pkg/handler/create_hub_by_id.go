package handler

import (
	"encoding/json"
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

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

// CreateHubByID creates a new hub with the given ID.
func (h *handler) CreateHubByID(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub, hubId string) error {
	if !validJSONQueryParam(ctx, "hubMetadata") {
		return h.rejectInvalidJSONParam(ctx, "hubMetadata")
	}

	newHub, err := zh.NewHub(hubId, string(ctx.QueryArgs().Peek("hubMetadata")), false)
	if err != nil {
		log.Error().Err(err).Send()
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "create hub error"})
	}

	if err := h.Upgrade(ctx, zh, newHub); err != nil {
		// remove the hub if the upgrade failed
		zh.RemoveHubById(newHub.GetId())
		log.Error().Err(fmt.Errorf("websocket upgrade error: %w", err)).Send()
		return h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "websocket upgrade error"})
	}

	return nil
}
