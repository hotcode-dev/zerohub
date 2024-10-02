package handler

import (
	"github.com/google/uuid"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
)

func (h *handler) CreateHubRandom(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error {
	if h.isMigrating {
		return h.ForwardMigrate(ctx)
	}

	return h.CreateHubByID(ctx, zh, uuid.NewString())
}
