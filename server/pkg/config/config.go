package config

import (
	"fmt"
	"os"

	goEnv "github.com/Netflix/go-env"
	"github.com/joho/godotenv"
	"go.uber.org/zap"
)

type Environment string

const (
	DevelopEnvironment    Environment = "dev"
	ProductionEnvironment Environment = "prod"
)

// Config represents configurations.
type Config struct {
	App AppConfig
}

// AppConfig represents Application configuration.
type AppConfig struct {
	Environment  Environment `env:"APP_ENVIRONMENT,default=dev"`
	Host         string      `env:"APP_HOST,default=0.0.0.0"`
	Port         string      `env:"APP_PORT,default=8080"`
	Domain       string      `env:"APP_DOMAIN,default=localhost"`
	ClientSecret string      `env:"APP_CLIENT_SECRET"`
	HubStorage   string      `env:"APP_HUB_STORAGE,default=memory"`
	PeerStorage  string      `env:"APP_PEER_STORAGE,default=memory"`
}

// LoadConfig loads a configuration.
func LoadConfig() (*Config, error) {
	configLogger, err := zap.NewProduction()
	if err != nil {
		return nil, fmt.Errorf("error to new zap: %w", err)
	}

	envFile := os.Getenv("ENV_FILE")
	if envFile == "" {
		envFile = ".env"
	}

	if err := godotenv.Load(envFile); err != nil {
		configLogger.Info("Error loading dot env file", zap.String("path", envFile))
	}

	var cfg Config
	_, err = goEnv.UnmarshalFromEnviron(&cfg)
	if err != nil {
		return nil, fmt.Errorf("error to unmarshall environments: %w", err)
	}

	return &cfg, nil
}
