package main

import (
	"fmt"
	stdLog "log"

	"github.com/ntsd/zero-hub/server/pkg/config"
	"github.com/ntsd/zero-hub/server/pkg/handler"
	"github.com/ntsd/zero-hub/server/pkg/logger"
	"github.com/ntsd/zero-hub/server/pkg/zerohub"
	"github.com/rs/zerolog/log"
)

func main() {
	cfg, err := config.LoadConfig()
	if err != nil {
		stdLog.Panic(fmt.Errorf("error to load config: %w", err))
	}

	if err := logger.InitLogger(cfg); err != nil {
		stdLog.Panic(fmt.Errorf("error to init logger: %w", err))
	}

	zh, err := zerohub.NewZeroHub(cfg)
	if err != nil {
		log.Panic().Err(fmt.Errorf("error to init zero hub: %w", err)).Send()
	}

	hdl, err := handler.NewHandler(cfg, zh)
	if err != nil {
		log.Panic().Err(fmt.Errorf("error to init logger: %w", err)).Send()
	}

	if err := hdl.Serve(); err != nil {
		log.Panic().Err(fmt.Errorf("error to serve: %w", err)).Send()
	}
}
