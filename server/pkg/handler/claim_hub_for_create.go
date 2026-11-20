package handler

import (
	"errors"
	"fmt"

	hub "github.com/hotcode-dev/zerohub/pkg/hub"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// claimHubForCreate runs the cross-mode claim under h.hubIdCrossModeMu and
// maps the result onto the shared create response contract: rejected -> 409
// already written by the claim helper (stop), ErrHubAlreadyExists -> 409
// "hub id already exists", any other error -> 500 "create hub error".
// Returns (nil, false) whenever a response has already been written and the
// caller must stop; (hub, true) on success.
func (h *handler) claimHubForCreate(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub, hubId string, isPermanent bool) (hub.Hub, bool) {
	hubMetadata := string(ctx.QueryArgs().Peek("hubMetadata"))
	newHub, err, rejected := h.claimUserChosenHubId(ctx, hubId, h.siblingInstances(zh),
		func() (hub.Hub, error) {
			return zh.CreateHubIfAbsent(hubId, hubMetadata, isPermanent)
		})
	if rejected {
		// A sibling mode already holds this id; claimUserChosenHubId
		// wrote the 409 Conflict, so stop without overwriting it.
		return nil, false
	}
	if err != nil {
		if errors.Is(err, zerohub.ErrHubAlreadyExists) {
			log.Error().Err(fmt.Errorf("hub with id %s already exists", hubId)).Send()
			// A marshal failure of this static map body is impossible, so
			// Response returns nil; callers stop on the bool, not the error.
			h.Response(ctx, fasthttp.StatusConflict, map[string]string{"error": "hub id already exists"})
		} else {
			log.Error().Err(err).Send()
			h.Response(ctx, fasthttp.StatusInternalServerError, map[string]string{"error": "create hub error"})
		}
		return nil, false
	}
	return newHub, true
}
