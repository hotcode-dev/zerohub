package handler

import (
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
)

// CreateHubStatic creates a new hub with a static ID.
func (h *handler) CreateHubStatic(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error {
	if h.isMigrating.Load() {
		return h.ForwardMigrate(ctx)
	}

	return h.CreateHubByID(ctx, zh, string(ctx.QueryArgs().Peek("id")))
}
