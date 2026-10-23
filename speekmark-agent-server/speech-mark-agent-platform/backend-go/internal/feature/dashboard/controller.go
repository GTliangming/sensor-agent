// 本文件为 dashboard 业务线的 HTTP 适配层（controller）。
package dashboard

import (
	"example.com/speech-mark-agent-platform/backend-go/internal/httpx"
	"github.com/gin-gonic/gin"
)

// Controller 持有仪表盘业务服务。
type Controller struct{ svc *Service }

// NewController 构造 dashboard.Controller，注入业务服务。
func NewController(svc *Service) *Controller { return &Controller{svc: svc} }

// RegisterRoutes 把仪表盘接口注册到 /api/v1/agent 分组下。
func (ctl *Controller) RegisterRoutes(api *gin.RouterGroup) {
	api.GET("/agent/dashboard", ctl.Get)
}

// Get 返回首页统计数据：运行总数、成功/失败/进行中数量、成功率与最近记录。
func (ctl *Controller) Get(c *gin.Context) {
	httpx.OK(c, ctl.svc.Get())
}
