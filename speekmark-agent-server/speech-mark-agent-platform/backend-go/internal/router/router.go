// Package router 是后端的“组装根”（composition root）：把数据库、配置、Agent 客户端、
// 各业务线的 repository/service/controller 依次装配起来，并注册中间件与路由，返回可用的 Gin 引擎。
// main 只需调用 router.New，保持入口精简；新增业务线时在此集中登记。
package router

import (
	"example.com/speech-mark-agent-platform/backend-go/internal/client"
	"example.com/speech-mark-agent-platform/backend-go/internal/config"
	"example.com/speech-mark-agent-platform/backend-go/internal/feature/approval"
	"example.com/speech-mark-agent-platform/backend-go/internal/feature/dashboard"
	"example.com/speech-mark-agent-platform/backend-go/internal/feature/health"
	"example.com/speech-mark-agent-platform/backend-go/internal/feature/knowledge"
	"example.com/speech-mark-agent-platform/backend-go/internal/feature/run"
	"example.com/speech-mark-agent-platform/backend-go/internal/middleware"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// New 根据数据库连接与配置装配整个 HTTP 层并返回 Gin 引擎。
func New(db *gorm.DB, cfg config.Config) *gin.Engine {
	// 空引擎 + 手动挂载中间件：Recovery 防崩溃、RequestID 注入追踪 ID、CORS 处理跨域。
	r := gin.New()
	r.Use(gin.Recovery(), middleware.RequestID(), middleware.CORS())

	// 共享基础依赖：各业务线的仓储与 Agent 客户端。
	agent := client.New(cfg.AgentBaseURL, cfg.AgentTimeout)
	runRepo := run.NewRepository(db)
	approvalRepo := approval.NewRepository(db)

	// 按业务线装配 service 与 controller。
	healthCtl := health.NewController(health.NewService(db), cfg.DatabaseDriver)
	runCtl := run.NewController(run.NewService(runRepo, agent, cfg.AgentTimeout))
	dashboardCtl := dashboard.NewController(dashboard.NewService(runRepo))
	approvalCtl := approval.NewController(approval.NewService(approvalRepo))
	knowledgeCtl := knowledge.NewController(knowledge.NewService())

	// 健康检查挂在根路径；其余业务接口统一挂在 /api/v1 分组下。
	healthCtl.RegisterRoutes(r)
	api := r.Group("/api/v1")
	runCtl.RegisterRoutes(api)
	dashboardCtl.RegisterRoutes(api)
	approvalCtl.RegisterRoutes(api)
	knowledgeCtl.RegisterRoutes(api)

	return r
}
