package handler

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"example.com/speech-mark-agent-platform/backend-go/internal/client"
	"example.com/speech-mark-agent-platform/backend-go/internal/config"
	"example.com/speech-mark-agent-platform/backend-go/internal/model"
	"example.com/speech-mark-agent-platform/backend-go/internal/repository"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Handler struct {
	db    *gorm.DB
	cfg   config.Config
	agent *client.AgentClient
	runs  *repository.RunRepository
}

func New(db *gorm.DB, cfg config.Config) *Handler {
	return &Handler{db: db, cfg: cfg, agent: client.New(cfg.AgentBaseURL, cfg.AgentTimeout), runs: repository.NewRunRepository(db)}
}
func ok(c *gin.Context, data any) {
	c.JSON(http.StatusOK, gin.H{"data": data, "request_id": c.GetString("request_id")})
}
func fail(c *gin.Context, status int, code, msg string) {
	c.JSON(status, gin.H{"error": gin.H{"code": code, "message": msg}, "request_id": c.GetString("request_id")})
}
func (h *Handler) Liveness(c *gin.Context) { ok(c, gin.H{"status": "alive", "service": "backend-go"}) }
func (h *Handler) Readiness(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	sqlDB, err := h.db.DB()
	if err != nil || sqlDB.PingContext(ctx) != nil {
		fail(c, 503, "DATABASE_NOT_READY", "数据库暂不可用")
		return
	}
	data := gin.H{"status": "ready", "database": h.cfg.DatabaseDriver, "redis": "disabled"}
	ok(c, data)
}
func (h *Handler) Dashboard(c *gin.Context) {
	var total, success, failed, running int64
	h.db.Model(&model.AgentRun{}).Count(&total)
	h.db.Model(&model.AgentRun{}).Where("status = ?", "succeeded").Count(&success)
	h.db.Model(&model.AgentRun{}).Where("status = ?", "failed").Count(&failed)
	h.db.Model(&model.AgentRun{}).Where("status IN ?", []string{"queued", "running"}).Count(&running)
	var recent []model.AgentRun
	h.db.Order("created_at desc").Limit(8).Find(&recent)
	ok(c, gin.H{"total_runs": total, "success_runs": success, "failed_runs": failed, "running_runs": running, "success_rate": rate(success, total), "recent_runs": recent})
}
func rate(a, b int64) float64 {
	if b == 0 {
		return 0
	}
	return float64(a) * 100 / float64(b)
}
func (h *Handler) ListRuns(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 10
	}
	items, total, err := h.runs.List(page, size, c.Query("status"), c.Query("keyword"))
	if err != nil {
		fail(c, 500, "QUERY_FAILED", "查询运行记录失败")
		return
	}
	ok(c, gin.H{"items": items, "total": total, "page": page, "page_size": size})
}

type createRunRequest struct {
	Input string `json:"input" binding:"required,min=1,max=12000"`
	Mode  string `json:"mode"`
}

func (h *Handler) CreateRun(c *gin.Context) {
	var req createRunRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, "INVALID_ARGUMENT", "input 必填，且长度不能超过 12000 字符")
		return
	}
	if req.Mode == "" {
		req.Mode = "balanced"
	}
	if req.Mode != "fast" && req.Mode != "balanced" && req.Mode != "careful" {
		fail(c, 400, "INVALID_MODE", "mode 仅支持 fast、balanced、careful")
		return
	}
	runID := "run_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	now := time.Now()
	run := model.AgentRun{RunID: runID, Input: req.Input, Mode: req.Mode, Status: "queued", StartedAt: now}
	if err := h.runs.Create(&run); err != nil {
		fail(c, 500, "CREATE_FAILED", "创建运行任务失败")
		return
	}
	trace := model.TraceEvent{EventID: "evt_" + uuid.NewString(), RunID: runID, Seq: 1, Type: "run.created", Node: "gateway", Title: "已创建任务", Detail: "Go 后端已接收请求，准备调用 Python Agent。", Status: "succeeded", CreatedAt: now}
	_ = h.db.Create(&trace).Error
	go h.execute(runID, req)
	ok(c, gin.H{"run_id": runID, "status": "queued", "started_at": now})
}
func (h *Handler) execute(runID string, req createRunRequest) {
	ctx, cancel := context.WithTimeout(context.Background(), h.cfg.AgentTimeout+15*time.Second)
	defer cancel()
	start := time.Now()
	_ = h.db.Model(&model.AgentRun{}).Where("run_id = ?", runID).Update("status", "running").Error
	result, err := h.agent.CreateRun(ctx, gin.H{"run_id": runID, "input": req.Input, "mode": req.Mode})
	if err == nil {
		if s, ok := result["status"].(string); ok && s == "failed" {
			errText, _ := result["error"].(string)
			err = stringError(errText)
		}
	}
	var final string
	status := "succeeded"
	errText := ""
	if err != nil {
		status = "failed"
		errText = err.Error()
	} else {
		final, _ = result["final_answer"].(string)
	}
	finished := time.Now()
	_ = h.db.Model(&model.AgentRun{}).Where("run_id = ?", runID).Updates(map[string]any{"status": status, "final_answer": final, "error": errText, "duration_ms": finished.Sub(start).Milliseconds(), "finished_at": finished}).Error
	_ = h.db.Create(&model.TraceEvent{EventID: "evt_" + uuid.NewString(), RunID: runID, Seq: 2, Type: "run.completed", Node: "gateway", Title: map[bool]string{true: "任务执行失败", false: "任务执行完成"}[err != nil], Detail: map[bool]string{true: errText, false: "Agent 已返回执行结果。"}[err != nil], Status: status, DurationMS: finished.Sub(start).Milliseconds(), CreatedAt: finished}).Error
}

type simpleError string

func (e simpleError) Error() string { return string(e) }
func stringError(s string) error {
	if s == "" {
		s = "Python Agent 执行失败"
	}
	return simpleError(s)
}
func (h *Handler) GetRun(c *gin.Context) {
	id := c.Param("id")
	run, err := h.runs.GetByRunID(id)
	if err != nil {
		fail(c, 404, "RUN_NOT_FOUND", "运行任务不存在")
		return
	}
	ok(c, run)
}
func (h *Handler) GetTrace(c *gin.Context) {
	id := c.Param("id")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	if remote, err := h.agent.GetTrace(ctx, id); err == nil {
		ok(c, remote)
		return
	}
	var items []model.TraceEvent
	if err := h.db.Where("run_id = ?", id).Order("seq asc, created_at asc").Find(&items).Error; err != nil {
		fail(c, 500, "TRACE_QUERY_FAILED", "查询执行轨迹失败")
		return
	}
	ok(c, gin.H{"run_id": id, "events": items})
}
func (h *Handler) CancelRun(c *gin.Context) {
	id := c.Param("id")
	var run model.AgentRun
	if err := h.db.Where("run_id = ?", id).First(&run).Error; err != nil {
		fail(c, 404, "RUN_NOT_FOUND", "运行任务不存在")
		return
	}
	if run.Status != "queued" && run.Status != "running" {
		fail(c, 409, "RUN_NOT_CANCELLABLE", "当前任务状态不允许取消")
		return
	}
	_ = h.db.Model(&run).Updates(map[string]any{"status": "cancelled", "finished_at": time.Now()}).Error
	ok(c, gin.H{"run_id": id, "status": "cancelled", "note": "骨架版本记录取消状态；生产环境需将取消信号传递给 Agent 工作流。"})
}
func (h *Handler) ListApprovals(c *gin.Context) {
	var items []model.Approval
	q := h.db.Order("created_at desc")
	if s := c.Query("status"); s != "" {
		q = q.Where("status = ?", s)
	}
	if err := q.Find(&items).Error; err != nil {
		fail(c, 500, "QUERY_FAILED", "查询审批列表失败")
		return
	}
	ok(c, gin.H{"items": items, "total": len(items)})
}
func (h *Handler) DecideApproval(c *gin.Context) {
	decision := c.Param("decision")
	if decision != "approve" && decision != "reject" {
		fail(c, 400, "INVALID_DECISION", "decision 仅支持 approve 或 reject")
		return
	}
	var body struct {
		Comment string `json:"comment"`
	}
	_ = c.ShouldBindJSON(&body)
	var item model.Approval
	if err := h.db.Where("approval_id = ? OR id = ?", c.Param("id"), c.Param("id")).First(&item).Error; err != nil {
		fail(c, 404, "APPROVAL_NOT_FOUND", "审批记录不存在")
		return
	}
	if item.Status != "pending" {
		fail(c, 409, "APPROVAL_ALREADY_DECIDED", "审批已处理，不能重复操作")
		return
	}
	status := "approved"
	if decision == "reject" {
		status = "rejected"
	}
	if err := h.db.Model(&item).Updates(map[string]any{"status": status, "comment": body.Comment}).Error; err != nil {
		fail(c, 500, "UPDATE_FAILED", "更新审批状态失败")
		return
	}
	ok(c, gin.H{"id": item.ApprovalID, "status": status})
}
func (h *Handler) ListKnowledge(c *gin.Context) {
	ok(c, gin.H{"items": []any{}, "total": 0, "message": "知识库接口骨架已就绪，下一阶段接入文档索引与向量检索。"})
}
func (h *Handler) SearchKnowledge(c *gin.Context) {
	var body struct {
		Query string `json:"query" binding:"required,min=1,max=2000"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, 400, "INVALID_ARGUMENT", "query 必填")
		return
	}
	ok(c, gin.H{"query": body.Query, "items": []any{}, "message": "当前为接口骨架，尚未接入向量数据库。"})
}
