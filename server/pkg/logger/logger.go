package logger

import (
	"github.com/hotcode-dev/zerohub/pkg/config"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/pkgerrors"
)

// InitLogger initial global zerolog logger
func InitLogger(cfg *config.Config) error {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	zerolog.ErrorStackMarshaler = pkgerrors.MarshalStack

	zerolog.SetGlobalLevel(zerolog.InfoLevel)
	if cfg.App.Environment == config.DevelopEnvironment {
		zerolog.SetGlobalLevel(zerolog.DebugLevel)
	}

	return nil
}
