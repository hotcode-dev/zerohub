package handler

import (
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
)

func (h *handler) CreateHub(ctx *fasthttp.RequestCtx) error {
	hub, err := zerohub.NewHub()
	if err != nil {
		return err
	}

	h.zh.AddHub(hub)

	return h.Upgrade(ctx, hub)
}
