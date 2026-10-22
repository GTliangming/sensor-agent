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
	cfg := config.Load()
	db, err := database.Open(cfg)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	if cfg.GinMode != "debug" {
		gin.SetMode(cfg.GinMode)
	}
	r := gin.New()
	r.Use(gin.Recovery(), middleware.RequestID(), middleware.CORS())
	h := handler.New(db, cfg)
	r.GET("/health/live", h.Liveness)
	r.GET("/health/ready", h.Readiness)
	api := r.Group("/api/v1")
	{
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

	srv := &http.Server{Addr: ":" + cfg.Port, Handler: r, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		log.Printf("Go API listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP 服务异常: %v", err)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("优雅关闭失败: %v", err)
	}
}
