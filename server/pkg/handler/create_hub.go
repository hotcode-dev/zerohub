package handler

import (
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
)

func (h *handler) CreateHub(ctx *fasthttp.RequestCtx) error {
	hubId := string(ctx.QueryArgs().Peek("id"))

	if h.mg.IsMigrating() {
		h.mg.AddMigrateHubID(hubId)
		return h.Forward(ctx)
	}

	if h := h.zh.GetHubByID(hubId); h != nil {
		ctx.Error("hub already exists", fasthttp.StatusConflict)
		return fmt.Errorf("hub with id %s already exists", hubId)
	}

	hub, err := zerohub.NewHub(hubId)
	if err != nil {
		ctx.Error("hub error", fasthttp.StatusServiceUnavailable)
		return fmt.Errorf("new hub error: %w", err)
	}

	h.zh.AddHub(hub)

	return h.Upgrade(ctx, hub)
}
