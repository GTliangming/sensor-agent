// Package handler 是整个 Go 后端的 HTTP 处理层（相当于 Python 里 FastAPI/Flask 的视图函数集合）。
// 它基于 Gin 框架接收请求，用 GORM 操作 SQLite 数据库，并通过 AgentClient 调用 Python Agent 服务，
// 负责健康检查、Dashboard 统计、运行记录（Run）的增删查、审批与知识库等接口。
package handler

import (
	// 标准库：context 控制超时/取消，strconv/strings 处理字符串与数字，time 处理时间
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	// 项目内部包：client 调用 Python Agent，config 读配置，model 定义表结构，repository 封装查询
	"example.com/speech-mark-agent-platform/backend-go/internal/client"
	"example.com/speech-mark-agent-platform/backend-go/internal/config"
	"example.com/speech-mark-agent-platform/backend-go/internal/model"
	"example.com/speech-mark-agent-platform/backend-go/internal/repository"
	// 第三方库：gin 是 Web 框架，uuid 生成唯一 ID，gorm 是 ORM（类似 Python 的 SQLAlchemy）
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Handler 聚合了处理请求所需的全部依赖（数据库、配置、Agent 客户端、Run 仓储），
// 所有接口方法都挂在它上面，类似 Python 里把依赖注入到一个类里再定义各个视图方法。
type Handler struct {
	// db 是数据库连接句柄
	db *gorm.DB
	// cfg 是应用配置
	cfg config.Config
	// agent 是调用 Python Agent 的客户端
	agent *client.AgentClient
	// runs 是 Run 记录的仓储（封装常用查询）
	runs *repository.RunRepository
}

// New 构造并返回一个 Handler 实例，顺带初始化 Agent 客户端与 Run 仓储。
func New(db *gorm.DB, cfg config.Config) *Handler {
	return &Handler{db: db, cfg: cfg, agent: client.New(cfg.AgentBaseURL, cfg.AgentTimeout), runs: repository.NewRunRepository(db)}
}

// ok 是统一的“成功响应”辅助函数：固定返回 200，并把业务数据放在 data 字段，
// 同时带上本次请求的 request_id，方便前后端对账与排查日志。
func ok(c *gin.Context, data any) {
	c.JSON(http.StatusOK, gin.H{"data": data, "request_id": c.GetString("request_id")})
}

// fail 是统一的“失败响应”辅助函数：用指定的 HTTP 状态码返回，
// error 里包含机器可读的 code 与给用户看的 message，并同样附带 request_id。
func fail(c *gin.Context, status int, code, msg string) {
	c.JSON(status, gin.H{"error": gin.H{"code": code, "message": msg}, "request_id": c.GetString("request_id")})
}

// Liveness 是存活探针：只要进程能响应就返回 alive，不检查任何外部依赖。
func (h *Handler) Liveness(c *gin.Context) { ok(c, gin.H{"status": "alive", "service": "backend-go"}) }

// Readiness 是就绪探针：通过 ping 数据库确认后端是否真正可以对外服务，
// 若数据库不可用则返回 503，让上游（如 K8s/负载均衡）暂时不要把流量打过来。
func (h *Handler) Readiness(c *gin.Context) {
	// 给数据库 ping 设置 2 秒超时，避免探针被卡死
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	sqlDB, err := h.db.DB()
	// 拿不到底层连接或 ping 失败，都视为数据库未就绪
	if err != nil || sqlDB.PingContext(ctx) != nil {
		fail(c, 503, "DATABASE_NOT_READY", "数据库暂不可用")
		return
	}
	data := gin.H{"status": "ready", "database": h.cfg.DatabaseDriver, "redis": "disabled"}
	ok(c, data)
}

// Dashboard 返回首页统计数据：聚合运行任务的总数、成功/失败/进行中数量、成功率，
// 以及最近 8 条运行记录，供前端仪表盘展示。
func (h *Handler) Dashboard(c *gin.Context) {
	// 分别按状态统计各类任务数量（COUNT 查询）
	var total, success, failed, running int64
	h.db.Model(&model.AgentRun{}).Count(&total)
	h.db.Model(&model.AgentRun{}).Where("status = ?", "succeeded").Count(&success)
	h.db.Model(&model.AgentRun{}).Where("status = ?", "failed").Count(&failed)
	// queued 和 running 都算作“进行中”
	h.db.Model(&model.AgentRun{}).Where("status IN ?", []string{"queued", "running"}).Count(&running)
	// 取最近创建的 8 条记录用于展示
	var recent []model.AgentRun
	h.db.Order("created_at desc").Limit(8).Find(&recent)
	ok(c, gin.H{"total_runs": total, "success_runs": success, "failed_runs": failed, "running_runs": running, "success_rate": rate(success, total), "recent_runs": recent})
}

// rate 计算百分比（a/b*100），分母为 0 时返回 0，避免除零错误。
func rate(a, b int64) float64 {
	if b == 0 {
		return 0
	}
	return float64(a) * 100 / float64(b)
}

// ListRuns 分页查询运行记录，支持按 status 和 keyword 过滤。
func (h *Handler) ListRuns(c *gin.Context) {
	// 解析分页参数：忽略转换错误，用默认值兜底
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	// 页码至少为 1
	if page < 1 {
		page = 1
	}
	// 每页条数限制在 1~100 之间，非法值回退为 10
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

// createRunRequest 是“创建运行任务”接口的请求体。
// binding 标签由 Gin 做入参校验：input 必填且长度 1~12000，mode 可选。
type createRunRequest struct {
	Input string `json:"input" binding:"required,min=1,max=12000"`
	Mode  string `json:"mode"`
}

// CreateRun 创建一次 Agent 运行任务：校验参数、落库、写入初始 Trace 事件，
// 再用 goroutine 异步调用 Python Agent，接口立即返回 queued 状态，不阻塞请求。
func (h *Handler) CreateRun(c *gin.Context) {
	// 绑定并校验请求体，不合法则返回 400
	var req createRunRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, "INVALID_ARGUMENT", "input 必填，且长度不能超过 12000 字符")
		return
	}
	// mode 缺省时默认 balanced
	if req.Mode == "" {
		req.Mode = "balanced"
	}
	// 只允许三种运行模式，其余一律拒绝
	if req.Mode != "fast" && req.Mode != "balanced" && req.Mode != "careful" {
		fail(c, 400, "INVALID_MODE", "mode 仅支持 fast、balanced、careful")
		return
	}
	// 生成全局唯一的 run_id（去掉 UUID 里的连字符，加上 run_ 前缀）
	runID := "run_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	now := time.Now()
	// 先把任务以 queued 状态写入数据库
	run := model.AgentRun{RunID: runID, Input: req.Input, Mode: req.Mode, Status: "queued", StartedAt: now}
	if err := h.runs.Create(&run); err != nil {
		fail(c, 500, "CREATE_FAILED", "创建运行任务失败")
		return
	}
	// 写入第一条 Trace 事件，记录“任务已创建”这一步（忽略写入错误，不影响主流程）
	trace := model.TraceEvent{EventID: "evt_" + uuid.NewString(), RunID: runID, Seq: 1, Type: "run.created", Node: "gateway", Title: "已创建任务", Detail: "Go 后端已接收请求，准备调用 Python Agent。", Status: "succeeded", CreatedAt: now}
	_ = h.db.Create(&trace).Error
	// 用 goroutine 异步执行（类似 Python 的后台任务），不阻塞 HTTP 响应
	go h.execute(runID, req)
	ok(c, gin.H{"run_id": runID, "status": "queued", "started_at": now})
}

// execute 在后台真正调用 Python Agent 并回写结果，由 CreateRun 以 goroutine 方式触发。
func (h *Handler) execute(runID string, req createRunRequest) {
	// 独立的后台 context，超时时间 = Agent 超时再加 15 秒缓冲
	ctx, cancel := context.WithTimeout(context.Background(), h.cfg.AgentTimeout+15*time.Second)
	defer cancel()
	start := time.Now()
	// 把任务状态从 queued 更新为 running
	_ = h.db.Model(&model.AgentRun{}).Where("run_id = ?", runID).Update("status", "running").Error
	// 调用 Python Agent 执行本次任务
	result, err := h.agent.CreateRun(ctx, gin.H{"run_id": runID, "input": req.Input, "mode": req.Mode})
	// Agent 虽返回成功，但结果里 status=failed 时，同样视为失败
	if err == nil {
		if s, ok := result["status"].(string); ok && s == "failed" {
			errText, _ := result["error"].(string)
			err = stringError(errText)
		}
	}
	// 根据是否出错，决定最终状态与要落库的字段
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
	// 回写最终状态、答案、错误信息与总耗时
	_ = h.db.Model(&model.AgentRun{}).Where("run_id = ?", runID).Updates(map[string]any{"status": status, "final_answer": final, "error": errText, "duration_ms": finished.Sub(start).Milliseconds(), "finished_at": finished}).Error
	// 再写一条“任务完成/失败”的 Trace 事件（用 map[bool]string 根据 err 选不同文案）
	_ = h.db.Create(&model.TraceEvent{EventID: "evt_" + uuid.NewString(), RunID: runID, Seq: 2, Type: "run.completed", Node: "gateway", Title: map[bool]string{true: "任务执行失败", false: "任务执行完成"}[err != nil], Detail: map[bool]string{true: errText, false: "Agent 已返回执行结果。"}[err != nil], Status: status, DurationMS: finished.Sub(start).Milliseconds(), CreatedAt: finished}).Error
}

// simpleError 是把字符串直接当作 error 的最小实现（Go 里 error 是接口，需实现 Error 方法）。
type simpleError string

func (e simpleError) Error() string { return string(e) }

// stringError 把一段文字包装成 error；文字为空时给出默认提示。
func stringError(s string) error {
	if s == "" {
		s = "Python Agent 执行失败"
	}
	return simpleError(s)
}

// GetRun 根据 run_id 查询单条运行记录，不存在则返回 404。
func (h *Handler) GetRun(c *gin.Context) {
	id := c.Param("id")
	run, err := h.runs.GetByRunID(id)
	if err != nil {
		fail(c, 404, "RUN_NOT_FOUND", "运行任务不存在")
		return
	}
	ok(c, run)
}

// GetTrace 查询某次运行的执行轨迹：优先向 Python Agent 拉取实时轨迹，
// 拉取失败时回退到本地数据库里存的 Trace 事件。
func (h *Handler) GetTrace(c *gin.Context) {
	id := c.Param("id")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	// 先尝试从 Agent 获取远端轨迹，成功就直接返回
	if remote, err := h.agent.GetTrace(ctx, id); err == nil {
		ok(c, remote)
		return
	}
	// 回退方案：按 seq、created_at 升序读取本地轨迹事件
	var items []model.TraceEvent
	if err := h.db.Where("run_id = ?", id).Order("seq asc, created_at asc").Find(&items).Error; err != nil {
		fail(c, 500, "TRACE_QUERY_FAILED", "查询执行轨迹失败")
		return
	}
	ok(c, gin.H{"run_id": id, "events": items})
}

// CancelRun 取消一次运行：仅当任务处于 queued 或 running 时允许取消。
func (h *Handler) CancelRun(c *gin.Context) {
	id := c.Param("id")
	// 先确认任务存在
	var run model.AgentRun
	if err := h.db.Where("run_id = ?", id).First(&run).Error; err != nil {
		fail(c, 404, "RUN_NOT_FOUND", "运行任务不存在")
		return
	}
	// 已结束（成功/失败/已取消）的任务不能再取消
	if run.Status != "queued" && run.Status != "running" {
		fail(c, 409, "RUN_NOT_CANCELLABLE", "当前任务状态不允许取消")
		return
	}
	// 当前骨架版本只在数据库标记为 cancelled，并记录结束时间
	_ = h.db.Model(&run).Updates(map[string]any{"status": "cancelled", "finished_at": time.Now()}).Error
	ok(c, gin.H{"run_id": id, "status": "cancelled", "note": "骨架版本记录取消状态；生产环境需将取消信号传递给 Agent 工作流。"})
}

// ListApprovals 查询审批列表，可按 status 过滤，按创建时间倒序返回。
func (h *Handler) ListApprovals(c *gin.Context) {
	var items []model.Approval
	q := h.db.Order("created_at desc")
	// 带了 status 参数就追加过滤条件
	if s := c.Query("status"); s != "" {
		q = q.Where("status = ?", s)
	}
	if err := q.Find(&items).Error; err != nil {
		fail(c, 500, "QUERY_FAILED", "查询审批列表失败")
		return
	}
	ok(c, gin.H{"items": items, "total": len(items)})
}

// DecideApproval 处理一条审批：decision 只能是 approve 或 reject，
// 且只能处理尚处于 pending 的记录，防止重复操作。
func (h *Handler) DecideApproval(c *gin.Context) {
	// 校验决定类型
	decision := c.Param("decision")
	if decision != "approve" && decision != "reject" {
		fail(c, 400, "INVALID_DECISION", "decision 仅支持 approve 或 reject")
		return
	}
	// 可选的审批备注（忽略绑定错误，允许空 body）
	var body struct {
		Comment string `json:"comment"`
	}
	_ = c.ShouldBindJSON(&body)
	// 按 approval_id 或主键 id 查找审批记录
	var item model.Approval
	if err := h.db.Where("approval_id = ? OR id = ?", c.Param("id"), c.Param("id")).First(&item).Error; err != nil {
		fail(c, 404, "APPROVAL_NOT_FOUND", "审批记录不存在")
		return
	}
	// 非 pending 状态说明已处理过，拒绝重复操作
	if item.Status != "pending" {
		fail(c, 409, "APPROVAL_ALREADY_DECIDED", "审批已处理，不能重复操作")
		return
	}
	// 把 approve/reject 映射为落库状态 approved/rejected
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

// ListKnowledge 是知识库列表的占位接口：当前返回空列表，后续接入文档索引与向量检索。
func (h *Handler) ListKnowledge(c *gin.Context) {
	ok(c, gin.H{"items": []any{}, "total": 0, "message": "知识库接口骨架已就绪，下一阶段接入文档索引与向量检索。"})
}

// SearchKnowledge 是知识库检索的占位接口：校验 query 必填，暂返回空结果。
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
