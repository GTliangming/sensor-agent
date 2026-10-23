// 本文件为 run 业务线的 HTTP 适配层（controller）：解析/校验请求、调用 Service、
// 把业务错误映射成 HTTP 状态码并写回响应。不碰数据库与 Agent 客户端。
package run

import (
	"context"
	"errors"
	"strconv"
	"time"

	"example.com/speech-mark-agent-platform/backend-go/internal/httpx"
	"github.com/gin-gonic/gin"
)

// Controller 持有 run 业务服务，提供各运行记录接口的处理方法。
type Controller struct{ svc *Service }

// NewController 构造 run.Controller，注入业务服务。
func NewController(svc *Service) *Controller { return &Controller{svc: svc} }

// RegisterRoutes 把运行记录相关接口注册到 /api/v1/agent 分组下。
func (ctl *Controller) RegisterRoutes(api *gin.RouterGroup) {
	api.GET("/agent/runs", ctl.List)
	api.POST("/agent/runs", ctl.Create)
	api.GET("/agent/runs/:id", ctl.Get)
	api.GET("/agent/runs/:id/trace", ctl.Trace)
	api.POST("/agent/runs/:id/cancel", ctl.Cancel)
}

// List 分页查询运行记录，支持按 status 和 keyword 过滤。
func (ctl *Controller) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 10
	}
	items, total, err := ctl.svc.List(page, size, c.Query("status"), c.Query("keyword"))
	if err != nil {
		httpx.Fail(c, 500, "QUERY_FAILED", "查询运行记录失败")
		return
	}
	httpx.OK(c, gin.H{"items": items, "total": total, "page": page, "page_size": size})
}

// Create 创建一次 Agent 运行任务：HTTP 校验后交给 Service 编排，立即返回 queued 状态。
func (ctl *Controller) Create(c *gin.Context) {
	var req createRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, 400, "INVALID_ARGUMENT", "input 必填，且长度不能超过 12000 字符")
		return
	}
	runID, startedAt, err := ctl.svc.Create(req.Input, req.Mode)
	if err != nil {
		if errors.Is(err, ErrInvalidMode) {
			httpx.Fail(c, 400, "INVALID_MODE", err.Error())
			return
		}
		httpx.Fail(c, 500, "CREATE_FAILED", "创建运行任务失败")
		return
	}
	httpx.OK(c, gin.H{"run_id": runID, "status": "queued", "started_at": startedAt})
}

// Get 根据 run_id 查询单条运行记录，不存在则返回 404。
func (ctl *Controller) Get(c *gin.Context) {
	rec, err := ctl.svc.Get(c.Param("id"))
	if err != nil {
		httpx.Fail(c, 404, "RUN_NOT_FOUND", "运行任务不存在")
		return
	}
	httpx.OK(c, rec)
}

// Trace 查询某次运行的执行轨迹：由 Service 决定优先取 Agent 实时轨迹还是回退本地事件。
func (ctl *Controller) Trace(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	data, err := ctl.svc.Trace(ctx, c.Param("id"))
	if err != nil {
		httpx.Fail(c, 500, "TRACE_QUERY_FAILED", "查询执行轨迹失败")
		return
	}
	httpx.OK(c, data)
}

// Cancel 取消一次运行：仅当任务处于 queued 或 running 时允许取消。
func (ctl *Controller) Cancel(c *gin.Context) {
	id := c.Param("id")
	err := ctl.svc.Cancel(id)
	switch {
	case errors.Is(err, ErrNotFound):
		httpx.Fail(c, 404, "RUN_NOT_FOUND", "运行任务不存在")
	case errors.Is(err, ErrNotCancellable):
		httpx.Fail(c, 409, "RUN_NOT_CANCELLABLE", "当前任务状态不允许取消")
	case err != nil:
		httpx.Fail(c, 500, "UPDATE_FAILED", "取消运行任务失败")
	default:
		httpx.OK(c, gin.H{"run_id": id, "status": "cancelled", "note": "骨架版本记录取消状态；生产环境需将取消信号传递给 Agent 工作流。"})
	}
}
