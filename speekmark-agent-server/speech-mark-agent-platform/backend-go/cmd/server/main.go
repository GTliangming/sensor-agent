// Command server 是整个后端服务的启动入口（main 包 + main 函数即可执行程序，类似 Python 的 if __name__ == "__main__"）。
// 职责：加载配置、打开数据库，交给 router 装配 HTTP 层，再交给 server 包管理服务生命周期。
package main

import (
	"log"
	"net/http"
	"time"

	"example.com/speech-mark-agent-platform/backend-go/internal/config"
	"example.com/speech-mark-agent-platform/backend-go/internal/database"
	"example.com/speech-mark-agent-platform/backend-go/internal/router"
	"example.com/speech-mark-agent-platform/backend-go/internal/server"
	"github.com/gin-gonic/gin"
)

func main() {
	// 加载配置（环境变量 + .env + 默认值）。
	cfg := config.Load()
	// 打开数据库并自动建表；失败则记录日志并退出进程（Fatalf 会调用 os.Exit(1)）。
	db, err := database.Open(cfg)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	// 非 debug 模式才显式设置 Gin 运行模式（如 release/test），debug 为 Gin 默认模式。
	if cfg.GinMode != "debug" {
		gin.SetMode(cfg.GinMode)
	}
	// 由组装根装配中间件、各业务线路由，返回可用的 Gin 引擎。
	r := router.New(db, cfg)

	// 构造 HTTP Server 并设置各类超时，避免慢连接长期占用资源；启动与优雅关闭交给 server.Run。
	srv := &http.Server{Addr: ":" + cfg.Port, Handler: r, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 60 * time.Second}
	server.Run(srv)
}
