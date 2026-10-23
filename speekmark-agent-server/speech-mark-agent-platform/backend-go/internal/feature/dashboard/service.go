// Package dashboard 是“首页仪表盘”业务线的特性包。
// 仪表盘本质是对运行记录的只读视图，因此 service 依赖 run.Repository 取统计数据，
// 本包只负责聚合与成功率计算，不单独拥有数据表。
package dashboard

import (
	"math"

	"example.com/speech-mark-agent-platform/backend-go/internal/feature/run"
	"example.com/speech-mark-agent-platform/backend-go/internal/model"
)

// Service 依赖运行记录仓储提供统计数据。
type Service struct{ runs *run.Repository }

// NewService 构造仪表盘服务，注入运行记录仓储。
func NewService(runs *run.Repository) *Service { return &Service{runs: runs} }

// Overview 是仪表盘概览的对外数据结构；json 标签与前端图表/卡片消费的字段保持一致。
type Overview struct {
	TotalRuns   int64            `json:"total_runs"`
	SuccessRuns int64            `json:"success_runs"`
	FailedRuns  int64            `json:"failed_runs"`
	RunningRuns int64            `json:"running_runs"` // 进行中（queued + running）
	WaitingRuns int64            `json:"waiting_runs"` // 待审批
	SuccessRate float64          `json:"success_rate"` // 百分比
	AvgDuration float64          `json:"avg_duration"` // 平均耗时（秒，保留 1 位小数）
	ToolCalls   int64            `json:"tool_calls"`   // 工具调用总数
	Daily       []run.DayCount   `json:"daily"`        // 近 7 天逐日运行计数
	RecentRuns  []model.AgentRun `json:"recent_runs"`
}

// Get 取运行统计与聚合指标，计算成功率与平均耗时，返回仪表盘概览。
// 默认展示最近 8 条记录与近 7 天趋势。
func (s *Service) Get() Overview {
	stats := s.runs.Stats(8)
	metrics := s.runs.Metrics(7)
	return Overview{
		TotalRuns:   stats.Total,
		SuccessRuns: stats.Success,
		FailedRuns:  stats.Failed,
		RunningRuns: stats.Running,
		WaitingRuns: stats.Waiting,
		SuccessRate: round1(rate(stats.Success, stats.Total)),
		AvgDuration: round1(metrics.AvgDurationMS / 1000),
		ToolCalls:   metrics.ToolCalls,
		Daily:       metrics.Daily,
		RecentRuns:  stats.Recent,
	}
}

// rate 计算百分比（a/b*100），分母为 0 时返回 0，避免除零错误。
func rate(a, b int64) float64 {
	if b == 0 {
		return 0
	}
	return float64(a) * 100 / float64(b)
}

// round1 保留 1 位小数，便于前端直接展示。
func round1(v float64) float64 {
	return math.Round(v*10) / 10
}
