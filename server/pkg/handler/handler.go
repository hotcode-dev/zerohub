package handler

import (
	"fmt"

	"github.com/ntsd/zero-hub/server/pkg/config"
	"github.com/ntsd/zero-hub/server/pkg/zerohub"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// Handler is the http and websocket handlers interface
type Handler interface {
	CreateHub(ctx *fasthttp.RequestCtx) error
	JoinHub(ctx *fasthttp.RequestCtx) error

	Upgrade(ctx *fasthttp.RequestCtx, hub zerohub.Hub) error

	Serve() error
}

type handler struct {
	cfg *config.Config
	zh  zerohub.ZeroHub
}

// NewHandler create a new handler
func NewHandler(cfg *config.Config, zh zerohub.ZeroHub) (Handler, error) {
	return &handler{
		cfg: cfg,
		zh:  zh,
	}, nil
}

func (h *handler) Serve() error {
	requestHandler := func(ctx *fasthttp.RequestCtx) {
		var err error
		switch string(ctx.Path()) {
		case "/hubs/create":
			err = h.CreateHub(ctx)
		case "/hubs/join":
			err = h.JoinHub(ctx)
		default:
			ctx.Error("unsupported path", fasthttp.StatusNotFound)
			return
		}
		if err != nil {
			log.Error().Err(err)
			ctx.Error(err.Error(), fasthttp.StatusServiceUnavailable)
		}
	}

	server := &fasthttp.Server{
		Handler: requestHandler,
		Name:    "zero-hub",
	}

	addr := fmt.Sprintf("%s:%s", h.cfg.App.Host, h.cfg.App.Port)
	log.Info().Msgf("listening to %s", addr)
	if err := server.ListenAndServe(addr); err != nil {
		log.Error().Err(fmt.Errorf("error to ListenAndServe: %w", err))
	}

	return nil
}
