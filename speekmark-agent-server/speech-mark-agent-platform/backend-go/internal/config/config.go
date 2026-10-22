package config

import (
	"os"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	Port, GinMode, DatabaseDriver, SQLitePath, AgentBaseURL, Environment string
	AgentTimeout                                                         time.Duration
}

func Load() Config {
	_ = godotenv.Load(".env", "../.env", "../../.env")
	return Config{
		Port: env("GO_PORT", "8080"), GinMode: env("GIN_MODE", "debug"),
		DatabaseDriver: env("DATABASE_DRIVER", "sqlite"), SQLitePath: env("SQLITE_PATH", "./data/agent_platform.db"),
		AgentBaseURL: env("AGENT_BASE_URL", "http://localhost:8000"), Environment: env("APP_ENV", "development"),
		AgentTimeout: 45 * time.Second,
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
