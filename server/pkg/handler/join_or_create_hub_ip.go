package handler

import (
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
)

func (h *handler) JoinOrCreateHubIP(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error {
	if h.isMigrating {
		return h.ForwardMigrate(ctx)
	}

	return h.JoinOrCreateHubByID(ctx, zh, ctx.RemoteIP().String())
}
