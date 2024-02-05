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
