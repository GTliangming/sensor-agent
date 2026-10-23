// 本文件为 knowledge 业务线的 HTTP 适配层（controller）。
package knowledge

import (
	"example.com/speech-mark-agent-platform/backend-go/internal/httpx"
	"github.com/gin-gonic/gin"
)

// Controller 持有知识库业务服务。
type Controller struct{ svc *Service }

// NewController 构造 knowledge.Controller，注入业务服务。
func NewController(svc *Service) *Controller { return &Controller{svc: svc} }

// RegisterRoutes 把知识库接口注册到 /api/v1/agent 分组下。
func (ctl *Controller) RegisterRoutes(api *gin.RouterGroup) {
	api.GET("/agent/knowledge", ctl.List)
	api.POST("/agent/knowledge/search", ctl.Search)
}

// List 返回知识库列表（当前为骨架）。
func (ctl *Controller) List(c *gin.Context) {
	httpx.OK(c, ctl.svc.List())
}

// Search 校验 query 必填后返回知识库检索结果（当前为骨架）。
func (ctl *Controller) Search(c *gin.Context) {
	var body struct {
		Query string `json:"query" binding:"required,min=1,max=2000"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.Fail(c, 400, "INVALID_ARGUMENT", "query 必填")
		return
	}
	httpx.OK(c, ctl.svc.Search(body.Query))
}
