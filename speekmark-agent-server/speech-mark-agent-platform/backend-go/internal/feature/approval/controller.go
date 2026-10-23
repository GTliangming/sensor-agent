// 本文件为 approval 业务线的 HTTP 适配层（controller）：解析/校验请求、调用 Service、
// 把业务错误映射成 HTTP 状态码。
package approval

import (
	"errors"

	"example.com/speech-mark-agent-platform/backend-go/internal/httpx"
	"github.com/gin-gonic/gin"
)

// Controller 持有 approval 业务服务。
type Controller struct{ svc *Service }

// NewController 构造 approval.Controller，注入业务服务。
func NewController(svc *Service) *Controller { return &Controller{svc: svc} }

// RegisterRoutes 把审批相关接口注册到 /api/v1/agent 分组下。
func (ctl *Controller) RegisterRoutes(api *gin.RouterGroup) {
	api.GET("/agent/approvals", ctl.List)
	api.POST("/agent/approvals/:id/:decision", ctl.Decide)
}

// List 查询审批列表，可按 status 过滤。
func (ctl *Controller) List(c *gin.Context) {
	items, err := ctl.svc.List(c.Query("status"))
	if err != nil {
		httpx.Fail(c, 500, "QUERY_FAILED", "查询审批列表失败")
		return
	}
	httpx.OK(c, gin.H{"items": items, "total": len(items)})
}

// Decide 处理一条审批：decision 只能是 approve 或 reject，且只能处理 pending 记录。
func (ctl *Controller) Decide(c *gin.Context) {
	var body struct {
		Comment string `json:"comment"`
	}
	_ = c.ShouldBindJSON(&body)

	approvalID, status, err := ctl.svc.Decide(c.Param("id"), c.Param("decision"), body.Comment)
	switch {
	case errors.Is(err, ErrInvalidDecision):
		httpx.Fail(c, 400, "INVALID_DECISION", "decision 仅支持 approve 或 reject")
	case errors.Is(err, ErrNotFound):
		httpx.Fail(c, 404, "APPROVAL_NOT_FOUND", "审批记录不存在")
	case errors.Is(err, ErrAlreadyDecided):
		httpx.Fail(c, 409, "APPROVAL_ALREADY_DECIDED", "审批已处理，不能重复操作")
	case err != nil:
		httpx.Fail(c, 500, "UPDATE_FAILED", "更新审批状态失败")
	default:
		httpx.OK(c, gin.H{"id": approvalID, "status": status})
	}
}
