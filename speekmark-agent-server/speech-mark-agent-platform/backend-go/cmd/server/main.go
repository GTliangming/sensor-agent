// Command server 是整个后端服务的启动入口（main 包 + main 函数即可执行程序，类似 Python 的 if __name__ == "__main__"）。
// 职责：加载配置、打开数据库、初始化 Gin 路由与中间件、注册 API，最后启动 HTTP 服务并支持优雅关闭。
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"example.com/speech-mark-agent-platform/backend-go/internal/config"
	"example.com/speech-mark-agent-platform/backend-go/internal/database"
	"example.com/speech-mark-agent-platform/backend-go/internal/handler"
	"example.com/speech-mark-agent-platform/backend-go/internal/middleware"
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
	// gin.New() 创建一个不含默认中间件的空引擎，再手动挂载：
	// Recovery 捕获 panic 防止进程崩溃、RequestID 为每个请求生成追踪 ID、CORS 处理跨域。
	r := gin.New()
	r.Use(gin.Recovery(), middleware.RequestID(), middleware.CORS())
	// 创建业务处理器，注入数据库连接与配置，供各路由回调使用。
	h := handler.New(db, cfg)
	// 健康检查接口：liveness 判断进程是否存活，readiness 判断是否可对外提供服务。
	r.GET("/health/live", h.Liveness)
	r.GET("/health/ready", h.Readiness)
	// 业务接口统一挂在 /api/v1 分组下（类似给一组路由加统一前缀）。
	api := r.Group("/api/v1")
	{
		// Agent 相关的仪表盘、运行记录、审批、知识库等各 REST 接口。
		api.GET("/agent/dashboard", h.Dashboard)
		api.GET("/agent/runs", h.ListRuns)
		api.POST("/agent/runs", h.CreateRun)
		api.GET("/agent/runs/:id", h.GetRun)
		api.GET("/agent/runs/:id/trace", h.GetTrace)
		api.POST("/agent/runs/:id/cancel", h.CancelRun)
		api.GET("/agent/approvals", h.ListApprovals)
		api.POST("/agent/approvals/:id/:decision", h.DecideApproval)
		api.GET("/agent/knowledge", h.ListKnowledge)
		api.POST("/agent/knowledge/search", h.SearchKnowledge)
	}

	// 构造 HTTP Server 并设置各类超时，避免慢连接长期占用资源。
	srv := &http.Server{Addr: ":" + cfg.Port, Handler: r, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 60 * time.Second}
	// 在单独的 goroutine（轻量级协程）中启动服务，使 main 不被阻塞，可继续等待退出信号。
	go func() {
		log.Printf("Go API listening on :%s", cfg.Port)
		// ListenAndServe 正常会一直阻塞；主动关闭时返回 ErrServerClosed，属预期不算错误。
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP 服务异常: %v", err)
		}
	}()
	// 监听系统中断信号（Ctrl+C 的 SIGINT、kill 的 SIGTERM），用于触发优雅关闭。
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	// 阻塞在此，直到从 stop 通道收到信号为止。
	<-stop
	// 给正在处理的请求最多 10 秒时间完成，超时则强制结束。
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// 优雅关闭：停止接收新请求并等待已有请求处理完成。
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("优雅关闭失败: %v", err)
	}
}
