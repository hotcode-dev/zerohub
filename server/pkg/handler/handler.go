package handler

import (
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/config"
	"github.com/hotcode-dev/zerohub/pkg/hub"
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
	CreateHubStatic(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error
	CreateHubRandom(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error
	JoinHub(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error
	JoinOrCreateHubStatic(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error
	JoinOrCreateHubIP(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error
	GetHub(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error

	Status(ctx *fasthttp.RequestCtx) error

	// reuse functions
	CreateHubByID(ctx *fasthttp.RequestCtx, zeroHub zerohub.ZeroHub, hubId string) error
	JoinOrCreateHubByID(ctx *fasthttp.RequestCtx, zeroHub zerohub.ZeroHub, hubId string) error

	// admin api
	Migrate(ctx *fasthttp.RequestCtx) error
	CreateHubPermanent(ctx *fasthttp.RequestCtx) error

	// websocket upgrade
	Upgrade(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub, hub hub.Hub) error

	Serve() error
}

type handler struct {
	address      string
	clientSecret string

	isMigrating bool
	backupHost  string

	zeroHub          zerohub.ZeroHub
	zeroHubRandom    zerohub.ZeroHub
	zeroHubIP        zerohub.ZeroHub
	zeroHubPermanent zerohub.ZeroHub
}

// NewHandler create a new handler
func NewHandler(cfg *config.Config, zeroHub zerohub.ZeroHub, zeroHubRandom zerohub.ZeroHub, zeroHubIP zerohub.ZeroHub, zerohubPermanent zerohub.ZeroHub) (Handler, error) {
	return &handler{
		address:          fmt.Sprintf("%s:%s", cfg.App.Host, cfg.App.Port),
		clientSecret:     cfg.App.ClientSecret,
		isMigrating:      false,
		backupHost:       "",
		zeroHub:          zeroHub,
		zeroHubRandom:    zeroHubRandom,
		zeroHubIP:        zeroHubIP,
		zeroHubPermanent: zerohubPermanent,
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
		case "/v1/status":
			err = h.Status(ctx)
		case "/v1/hubs/create":
			err = h.CreateHubStatic(ctx, h.zeroHub)
		case "/v1/hubs/get":
			err = h.GetHub(ctx, h.zeroHub)
		case "/v1/hubs/join":
			err = h.JoinHub(ctx, h.zeroHub)
		case "/v1/hubs/join-or-create":
			err = h.JoinOrCreateHubStatic(ctx, h.zeroHub)
		case "/v1/random-hubs/create":
			err = h.CreateHubRandom(ctx, h.zeroHubRandom)
		case "/v1/random-hubs/get":
			err = h.GetHub(ctx, h.zeroHubRandom)
		case "/v1/random-hubs/join":
			err = h.JoinHub(ctx, h.zeroHubRandom)
		case "/v1/ip-hubs/join-or-create":
			err = h.JoinOrCreateHubIP(ctx, h.zeroHubIP)
		case "/v1/ip-hubs/join":
			err = h.JoinHub(ctx, h.zeroHubIP)
		case "/v1/admin/migrate":
			err = h.Migrate(ctx)
		case "/v1/permanent-hubs/join":
			err = h.JoinHub(ctx, h.zeroHubPermanent)
		case "/v1/permanent-hubs/create":
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
