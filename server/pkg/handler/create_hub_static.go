package handler

import (
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// CreateHubStatic creates a new hub with a static ID.
func (h *handler) CreateHubStatic(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error {
	if h.isMigrating {
		return h.ForwardMigrate(ctx)
	}

	hubId := string(ctx.QueryArgs().Peek("id"))
	if zh.GetHubById(hubId) != nil {
		log.Error().Err(fmt.Errorf("hub with id %s already exists", hubId)).Send()
		return h.Response(ctx, fasthttp.StatusConflict, map[string]string{"error": "hub id already exists"})
	}

	return h.CreateHubByID(ctx, zh, hubId)
}
