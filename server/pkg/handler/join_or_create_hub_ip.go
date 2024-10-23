package handler

import (
	"strconv"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
	"github.com/zeebo/xxh3"
)

func (h *handler) JoinOrCreateHubIP(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error {
	if h.isMigrating {
		return h.ForwardMigrate(ctx)
	}

	return h.JoinOrCreateHubByID(ctx, zh, strconv.FormatUint(xxh3.HashString(ctx.RemoteIP().String()), 10))
}
