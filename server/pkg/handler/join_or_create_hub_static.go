package handler

import (
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
)

// JoinOrCreateHubStatic joins or creates a hub with a static ID.
func (h *handler) JoinOrCreateHubStatic(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error {
	if h.isMigrating {
		return h.ForwardMigrate(ctx)
	}

	return h.JoinOrCreateHubByID(ctx, zh, string(ctx.QueryArgs().Peek("id")))
}
