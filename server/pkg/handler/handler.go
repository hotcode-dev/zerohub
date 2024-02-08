package handler

import (
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/config"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
	limiter "github.com/ulule/limiter/v3"
	limiterFasthttp "github.com/ulule/limiter/v3/drivers/middleware/fasthttp"
	limiterMemory "github.com/ulule/limiter/v3/drivers/store/memory"
	"github.com/valyala/fasthttp"
)

// Handler is the http and websocket handlers interface
type Handler interface {
	CreateHub(ctx *fasthttp.RequestCtx) error
	JoinHub(ctx *fasthttp.RequestCtx) error
	Migrate(ctx *fasthttp.RequestCtx) error

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
	rate, err := limiter.NewRateFromFormatted("10-H") // 10 requests per hour.
	if err != nil {
		return fmt.Errorf("error to create rate: %w", err)
	}
	rateLimitMiddleware := limiterFasthttp.NewMiddleware(limiter.New(limiterMemory.NewStore(), rate, limiter.WithTrustForwardHeader(true)))

	requestHandler := func(ctx *fasthttp.RequestCtx) {
		var err error
		switch string(ctx.Path()) {
		case "/hubs/create":
			err = h.CreateHub(ctx)
		case "/hubs/join":
			err = h.JoinHub(ctx)
		case "/configs/migrate":
			err = h.Migrate(ctx)
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
		Handler: rateLimitMiddleware.Handle(requestHandler),
		Name:    "ZeroHub",
	}

	addr := fmt.Sprintf("%s:%s", h.cfg.App.Host, h.cfg.App.Port)
	log.Info().Msgf("listening to %s", addr)
	if err := server.ListenAndServe(addr); err != nil {
		return fmt.Errorf("error to ListenAndServe: %w", err)
	}

	return nil
}
