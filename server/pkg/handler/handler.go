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
	// public api
	CreateHub(ctx *fasthttp.RequestCtx) error
	JoinHub(ctx *fasthttp.RequestCtx) error
	Status(ctx *fasthttp.RequestCtx) error
	GetHub(ctx *fasthttp.RequestCtx) error

	// admin api
	Migrate(ctx *fasthttp.RequestCtx) error
	CreateHubPermanent(ctx *fasthttp.RequestCtx) error

	// websocket upgrade
	Upgrade(ctx *fasthttp.RequestCtx, hub zerohub.Hub) error

	Serve() error
}

type handler struct {
	address      string
	clientSecret string

	isMigrating bool
	backupHost  string

	zh zerohub.ZeroHub
}

// NewHandler create a new handler
func NewHandler(cfg *config.Config, zh zerohub.ZeroHub) (Handler, error) {
	return &handler{
		address:      fmt.Sprintf("%s:%s", cfg.App.Host, cfg.App.Port),
		clientSecret: cfg.App.ClientSecret,
		isMigrating:  false,
		backupHost:   "",
		zh:           zh,
	}, nil
}

func (h *handler) Serve() error {
	// TODO: replace limiter with non library rate limiter
	rate, err := limiter.NewRateFromFormatted("10-M") // 10 requests per minute.
	if err != nil {
		return fmt.Errorf("error to create rate: %w", err)
	}
	rateLimitMiddleware := limiterFasthttp.NewMiddleware(limiter.New(limiterMemory.NewStore(), rate, limiter.WithTrustForwardHeader(true)))

	requestHandler := func(ctx *fasthttp.RequestCtx) {
		log.Debug().Msgf("%s %s", ctx.Method(), ctx.RequestURI())

		var err error
		switch string(ctx.Path()) {
		case "/status":
			err = h.Status(ctx)
		case "/hubs/create":
			err = h.CreateHub(ctx)
		case "/hubs/get":
			err = h.GetHub(ctx)
		case "/hubs/join":
			err = h.JoinHub(ctx)
		case "/admin/migrate":
			err = h.Migrate(ctx)
		case "/admin/create":
			err = h.CreateHubPermanent(ctx)
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
		Handler:            rateLimitMiddleware.Handle(requestHandler),
		Name:               "ZeroHub",
		MaxRequestBodySize: config.HTTPMaxRequestBodySize,
	}

	log.Info().Msgf("listening to %s", h.address)
	if err := server.ListenAndServe(h.address); err != nil {
		return fmt.Errorf("error to ListenAndServe: %w", err)
	}

	return nil
}
