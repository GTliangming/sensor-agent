// 本文件为 health 业务线的 HTTP 适配层（controller）。健康检查路由挂在根路径下，
// 不走 /api/v1 业务分组，便于负载均衡/K8s 直接探测。
package health

import (
	"context"
	"time"

	"example.com/speech-mark-agent-platform/backend-go/internal/httpx"
	"github.com/gin-gonic/gin"
)

// Controller 持有健康检查服务与数据库驱动名（用于就绪响应展示）。
type Controller struct {
	svc    *Service
	driver string
}

// NewController 构造 health.Controller，注入服务与数据库驱动名。
func NewController(svc *Service, driver string) *Controller {
	return &Controller{svc: svc, driver: driver}
}

// RegisterRoutes 把健康检查接口注册到根路径（/health/live、/health/ready）。
func (ctl *Controller) RegisterRoutes(r *gin.Engine) {
	r.GET("/health/live", ctl.Liveness)
	r.GET("/health/ready", ctl.Readiness)
}

// Liveness 是存活探针：只要进程能响应就返回 alive，不检查任何外部依赖。
func (ctl *Controller) Liveness(c *gin.Context) {
	httpx.OK(c, gin.H{"status": "alive", "service": "backend-go"})
}

// Readiness 是就绪探针：探测数据库连通性，不可用则返回 503。
func (ctl *Controller) Readiness(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	if err := ctl.svc.Ping(ctx); err != nil {
		httpx.Fail(c, 503, "DATABASE_NOT_READY", "数据库暂不可用")
		return
	}
	httpx.OK(c, gin.H{"status": "ready", "database": ctl.driver, "redis": "disabled"})
}
