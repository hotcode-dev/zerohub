package handler

import (
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
)

// CreateHubStatic creates a new hub with a static ID. The check-then-create
// is atomic inside CreateHubByID (via CreateHubIfAbsent), so concurrent
// creates of the same ID collapse to one 409 instead of orphaning a hub.
func (h *handler) CreateHubStatic(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error {
	if h.isMigrating.Load() {
		return h.ForwardMigrate(ctx)
	}

	return h.CreateHubByID(ctx, zh, string(ctx.QueryArgs().Peek("id")))
}
