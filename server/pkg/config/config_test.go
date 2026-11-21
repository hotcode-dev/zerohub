package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// appEnvKeys lists every environment variable read by LoadConfig.
var appEnvKeys = []string{
	"ENV_FILE", "APP_ENVIRONMENT", "APP_HOST", "APP_PORT", "APP_CLIENT_SECRET",
	"APP_HUB_STORAGE", "APP_PEER_STORAGE", "APP_TRUST_PROXY", "APP_ALLOWED_ORIGINS",
}

// clearAppEnv points ENV_FILE at a guaranteed-missing file and unsets every
// APP_* variable so LoadConfig behavior is fully determined by this test,
// regardless of the CI environment. Values are restored after each test.
func clearAppEnv(t *testing.T) {
	t.Helper()
	missing := filepath.Join(t.TempDir(), "does-not-exist.env")
	os.Setenv("ENV_FILE", missing)
	t.Cleanup(func() { os.Unsetenv("ENV_FILE") })
	for _, key := range appEnvKeys {
		old, had := os.LookupEnv(key)
		os.Unsetenv(key)
		if had {
			t.Cleanup(func() { os.Setenv(key, old) })
		} else {
			t.Cleanup(func() { os.Unsetenv(key) })
		}
	}
}

// TestLoadConfigDefaults pins the default configuration when no environment
// values are provided: the dev defaults documented on AppConfig.
func TestLoadConfigDefaults(t *testing.T) {
	clearAppEnv(t)

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error = %v, want nil", err)
	}

	want := AppConfig{
		Environment:    DevelopEnvironment,
		Host:           "0.0.0.0",
		Port:           "8080",
		HubStorage:     "memory",
		PeerStorage:    "memory",
		TrustProxy:     false,
		AllowedOrigins: "",
	}
	if cfg.App != want {
		t.Fatalf("LoadConfig().App = %+v, want %+v", cfg.App, want)
	}
}

// TestLoadConfigEnvOverrides pins that process environment values win and
// every APP_* field round-trips through LoadConfig.
func TestLoadConfigEnvOverrides(t *testing.T) {
	clearAppEnv(t)
	os.Setenv("APP_ENVIRONMENT", "prod")
	os.Setenv("APP_HOST", "127.0.0.1")
	os.Setenv("APP_PORT", "9091")
	os.Setenv("APP_CLIENT_SECRET", "s3cret")
	os.Setenv("APP_HUB_STORAGE", "gache")
	os.Setenv("APP_PEER_STORAGE", "gache")
	os.Setenv("APP_TRUST_PROXY", "true")
	os.Setenv("APP_ALLOWED_ORIGINS", "https://a.example,https://b.example")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error = %v, want nil", err)
	}

	want := AppConfig{
		Environment:    Environment("prod"),
		Host:           "127.0.0.1",
		Port:           "9091",
		ClientSecret:   "s3cret",
		HubStorage:     "gache",
		PeerStorage:    "gache",
		TrustProxy:     true,
		AllowedOrigins: "https://a.example,https://b.example",
	}
	if cfg.App != want {
		t.Fatalf("LoadConfig().App = %+v, want %+v", cfg.App, want)
	}
}

// TestLoadConfigMissingEnvFile pins the core contract of LoadConfig after
// the zap removal: a missing or unreadable .env file is NOT an error — the
// server simply falls back to the process environment.
func TestLoadConfigMissingEnvFile(t *testing.T) {
	clearAppEnv(t)
	os.Setenv("APP_PORT", "7777")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() with missing ENV_FILE error = %v, want nil", err)
	}
	if cfg.App.Port != "7777" {
		t.Fatalf("LoadConfig().App.Port = %q, want process environment value %q", cfg.App.Port, "7777")
	}
}

// TestLoadConfigReadsEnvFile pins that values are read from the file named
// by ENV_FILE when the process environment does not already define them
// (godotenv semantics: existing variables are not overwritten).
func TestLoadConfigReadsEnvFile(t *testing.T) {
	clearAppEnv(t)

	envFile := filepath.Join(t.TempDir(), "test.env")
	if err := os.WriteFile(envFile, []byte("APP_CLIENT_SECRET=file-secret\nAPP_PORT=6060\n"), 0o600); err != nil {
		t.Fatalf("write ENV_FILE: %v", err)
	}
	os.Setenv("ENV_FILE", envFile)

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error = %v, want nil", err)
	}
	if cfg.App.ClientSecret != "file-secret" {
		t.Fatalf("LoadConfig().App.ClientSecret = %q, want %q", cfg.App.ClientSecret, "file-secret")
	}
	if cfg.App.Port != "6060" {
		t.Fatalf("LoadConfig().App.Port = %q, want %q", cfg.App.Port, "6060")
	}
}

// TestLoadConfigInvalidValue pins the error path: an unparseable environment
// value (bool field given a non-bool) must surface as a wrapped error from
// go-env, not a panic or a silent default.
func TestLoadConfigInvalidValue(t *testing.T) {
	clearAppEnv(t)
	os.Setenv("APP_TRUST_PROXY", "not-a-bool")

	_, err := LoadConfig()
	if err == nil {
		t.Fatal("LoadConfig() error = nil, want an unmarshall error")
	}
	if !strings.Contains(err.Error(), "error to unmarshall environments") {
		t.Fatalf("LoadConfig() error = %q, want it to contain %q", err.Error(), "error to unmarshall environments")
	}
}
