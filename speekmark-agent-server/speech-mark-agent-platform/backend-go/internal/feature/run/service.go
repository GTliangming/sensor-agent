// 本文件为 run 业务线的业务编排层：校验业务规则、调用 repository 读写、
// 协调 Agent 调用并串联 Trace。不碰 Gin/HTTP，也不直接拼 SQL。
package run

import (
	"context"
	"strings"
	"time"

	"example.com/speech-mark-agent-platform/backend-go/internal/client"
	"example.com/speech-mark-agent-platform/backend-go/internal/model"
	"github.com/google/uuid"
)

// Service 承接运行记录相关的全部业务编排：
// 依赖 Repository 读写数据库、依赖 client 调用 Python Agent，agentTimeout 用于后台执行超时上界。
type Service struct {
	repo         *Repository
	agent        *client.AgentClient
	agentTimeout time.Duration
}

// NewService 构造 run.Service，注入仓储、Agent 客户端与 Agent 超时时间。
func NewService(repo *Repository, agent *client.AgentClient, agentTimeout time.Duration) *Service {
	return &Service{repo: repo, agent: agent, agentTimeout: agentTimeout}
}

// normalizeMode 将空模式补为默认 balanced，并校验取值合法性。
func normalizeMode(mode string) (string, error) {
	if mode == "" {
		mode = "balanced"
	}
	if mode != "fast" && mode != "balanced" && mode != "careful" {
		return "", ErrInvalidMode
	}
	return mode, nil
}

// Create 创建一次运行：校验模式、落库为 queued、写入初始 Trace 事件，
// 再以 goroutine 异步调用 Python Agent。返回生成的 run_id 与开始时间。
func (s *Service) Create(input, mode string) (string, time.Time, error) {
	mode, err := normalizeMode(mode)
	if err != nil {
		return "", time.Time{}, err
	}
	runID := "run_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	now := time.Now()
	rec := model.AgentRun{RunID: runID, Input: input, Mode: mode, Status: "queued", StartedAt: now}
	if err := s.repo.Create(&rec); err != nil {
		return "", time.Time{}, err
	}
	_ = s.repo.CreateTrace(&model.TraceEvent{
		EventID: "evt_" + uuid.NewString(), RunID: runID, Seq: 1, Type: "run.created",
		Node: "gateway", Title: "已创建任务", Detail: "Go 后端已接收请求，准备调用 Python Agent。",
		Status: "succeeded", CreatedAt: now,
	})
	go s.execute(runID, input, mode)
	return runID, now, nil
}

// execute 在后台真正调用 Python Agent 并回写结果，由 Create 以 goroutine 方式触发。
func (s *Service) execute(runID, input, mode string) {
	ctx, cancel := context.WithTimeout(context.Background(), s.agentTimeout+15*time.Second)
	defer cancel()
	start := time.Now()
	_ = s.repo.UpdateStatus(runID, "running")
	result, err := s.agent.CreateRun(ctx, map[string]any{"run_id": runID, "input": input, "mode": mode})
	if err == nil {
		if st, ok := result["status"].(string); ok && st == "failed" {
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
	_ = s.repo.UpdateResult(runID, status, final, errText, finished.Sub(start).Milliseconds(), finished)
	_ = s.repo.CreateTrace(&model.TraceEvent{
		EventID: "evt_" + uuid.NewString(), RunID: runID, Seq: 2, Type: "run.completed", Node: "gateway",
		Title:  map[bool]string{true: "任务执行失败", false: "任务执行完成"}[err != nil],
		Detail: map[bool]string{true: errText, false: "Agent 已返回执行结果。"}[err != nil],
		Status: status, DurationMS: finished.Sub(start).Milliseconds(), CreatedAt: finished,
	})
}

// Get 按 run_id 查询单条运行记录；未找到时返回 ErrNotFound。
func (s *Service) Get(runID string) (model.AgentRun, error) {
	rec, err := s.repo.GetByRunID(runID)
	if err != nil {
		return model.AgentRun{}, ErrNotFound
	}
	return rec, nil
}

// List 分页查询运行记录，透传过滤条件给仓储。
func (s *Service) List(page, pageSize int, status, keyword string) ([]model.AgentRun, int64, error) {
	return s.repo.List(page, pageSize, status, keyword)
}

// Trace 查询执行轨迹：优先向 Python Agent 拉取实时轨迹，失败时回退本地数据库里的 Trace 事件。
func (s *Service) Trace(ctx context.Context, runID string) (map[string]any, error) {
	if remote, err := s.agent.GetTrace(ctx, runID); err == nil {
		return remote, nil
	}
	items, err := s.repo.ListTrace(runID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"run_id": runID, "events": items}, nil
}

// Cancel 取消一次运行：仅当任务处于 queued 或 running 时允许取消。
// 未找到返回 ErrNotFound；状态不允许取消返回 ErrNotCancellable。
func (s *Service) Cancel(runID string) error {
	rec, err := s.repo.GetByRunID(runID)
	if err != nil {
		return ErrNotFound
	}
	if rec.Status != "queued" && rec.Status != "running" {
		return ErrNotCancellable
	}
	return s.repo.MarkCancelled(&rec, time.Now())
}
