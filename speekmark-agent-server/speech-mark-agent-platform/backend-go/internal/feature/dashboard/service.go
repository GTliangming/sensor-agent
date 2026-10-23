// Package dashboard 是“首页仪表盘”业务线的特性包。
// 仪表盘本质是对运行记录的只读视图，因此 service 依赖 run.Repository 取统计数据，
// 本包只负责聚合与成功率计算，不单独拥有数据表。
package dashboard

import (
	"example.com/speech-mark-agent-platform/backend-go/internal/feature/run"
	"example.com/speech-mark-agent-platform/backend-go/internal/model"
)

// Service 依赖运行记录仓储提供统计数据。
type Service struct{ runs *run.Repository }

// NewService 构造仪表盘服务，注入运行记录仓储。
func NewService(runs *run.Repository) *Service { return &Service{runs: runs} }

// Overview 是仪表盘概览的对外数据结构；json 标签与原接口字段保持一致。
type Overview struct {
	TotalRuns   int64            `json:"total_runs"`
	SuccessRuns int64            `json:"success_runs"`
	FailedRuns  int64            `json:"failed_runs"`
	RunningRuns int64            `json:"running_runs"`
	SuccessRate float64          `json:"success_rate"`
	RecentRuns  []model.AgentRun `json:"recent_runs"`
}

// Get 取运行统计并计算成功率，返回仪表盘概览。默认展示最近 8 条记录。
func (s *Service) Get() Overview {
	stats := s.runs.Stats(8)
	return Overview{
		TotalRuns:   stats.Total,
		SuccessRuns: stats.Success,
		FailedRuns:  stats.Failed,
		RunningRuns: stats.Running,
		SuccessRate: rate(stats.Success, stats.Total),
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
