package main

import (
	"fmt"
	stdLog "log"

	"github.com/hotcode-dev/zerohub/pkg/config"
	"github.com/hotcode-dev/zerohub/pkg/handler"
	"github.com/hotcode-dev/zerohub/pkg/logger"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/rs/zerolog/log"
)

// main is the entry point of the application.
// It loads the configuration, initializes the logger, creates a new ZeroHub instance,
// creates a new handler, and starts the server.
func main() {
	cfg, err := config.LoadConfig()
	if err != nil {
		stdLog.Panic(fmt.Errorf("error to load config: %w", err))
	}

	if err := logger.InitLogger(cfg); err != nil {
		stdLog.Panic(fmt.Errorf("error to init logger: %w", err))
	}

	zeroHub := newZeroHubOrPanic(cfg, "static")
	zeroHubRandom := newZeroHubOrPanic(cfg, "random")
	zeroHubIP := newZeroHubOrPanic(cfg, "ip")
	zeroHubPermanent := newZeroHubOrPanic(cfg, "permanent")

	hdl, err := handler.NewHandler(cfg, zeroHub, zeroHubRandom, zeroHubIP, zeroHubPermanent)
	if err != nil {
		log.Panic().Err(fmt.Errorf("error to init handler: %w", err)).Send()
	}

	if err := hdl.Serve(); err != nil {
		log.Error().Err(fmt.Errorf("error to serve: %w", err)).Send()
	}
}

// newZeroHubOrPanic creates a new ZeroHub instance for the given hub mode name.
// It aborts startup via panic on any construction failure.
func newZeroHubOrPanic(cfg *config.Config, name string) zerohub.ZeroHub {
	zh, err := zerohub.NewZeroHub(cfg)
	if err != nil {
		log.Panic().Err(fmt.Errorf("error to init %s zero hub: %w", name, err)).Send()
	}
	return zh
}
