// Package config 负责加载并集中管理整个服务的运行配置。
// 配置来源优先级：先读取 .env 文件写入环境变量，再从环境变量读取；
// 若对应环境变量缺失则使用代码里给定的默认值（相当于 Python 里的 os.getenv(key, default)）。
package config

import (
	"os"
	"time"

	"github.com/joho/godotenv"
)

// Config 是服务的全局配置结构体，集中保存端口、运行模式、数据库、下游 Agent 等参数。
// 类比 Python 中用一个 dataclass/Settings 对象统一承载所有配置项。
type Config struct {
	// 多个 string 字段合并声明：HTTP 端口、Gin 运行模式、数据库驱动、SQLite 路径、Agent 服务地址、运行环境。
	Port, GinMode, DatabaseDriver, SQLitePath, AgentBaseURL, Environment string
	// 调用下游 Agent 服务时的超时时间。
	AgentTimeout time.Duration
}

// Load 加载配置并返回一个 Config：先尝试读取 .env 文件，再逐项从环境变量取值（缺失时回退到默认值）。
func Load() Config {
	// 依次尝试当前目录及上两级目录的 .env 文件，把其中的键值注入环境变量；
	// 忽略返回的 error（用 _ 丢弃），因为 .env 不存在属于正常情况，不应中断启动。
	_ = godotenv.Load(".env", "../.env", "../../.env")
	return Config{
		// 每个字段都通过 env(key, fallback) 读取：有环境变量用环境变量，否则用第二个参数的默认值。
		Port:           env("GO_PORT", "8080"),
		GinMode:        env("GIN_MODE", "debug"),
		DatabaseDriver: env("DATABASE_DRIVER", "sqlite"),
		SQLitePath:     env("SQLITE_PATH", "./data/agent_platform.db"),
		AgentBaseURL:   env("AGENT_BASE_URL", "http://localhost:8000"),
		Environment:    env("APP_ENV", "development"),
		AgentTimeout:   45 * time.Second,
	}
}

// env 读取名为 key 的环境变量：非空则返回其值，否则返回 fallback 默认值。
func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
