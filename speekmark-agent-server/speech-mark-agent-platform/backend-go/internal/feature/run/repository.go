// Package run 是“运行记录（Run）”这条业务线的特性包，内聚其全栈：
// controller（HTTP 适配）、service（业务编排）、repository（数据访问）与 types（包内类型）。
// 本文件为数据访问层：所有对 AgentRun、TraceEvent 两张表的 SQL/GORM 操作收敛于此。
package run

import (
	"strings"
	"time"

	"example.com/speech-mark-agent-platform/backend-go/internal/model"
	"gorm.io/gorm"
)

// Repository 持有数据库句柄，负责运行记录与执行轨迹的读写。
type Repository struct{ db *gorm.DB }

// NewRepository 构造运行记录仓储，注入 GORM 句柄。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// Create 向数据库插入一条新的运行记录。
func (r *Repository) Create(run *model.AgentRun) error { return r.db.Create(run).Error }

// GetByRunID 按业务主键 run_id 查询单条运行记录；查不到返回 gorm.ErrRecordNotFound。
func (r *Repository) GetByRunID(runID string) (model.AgentRun, error) {
	var run model.AgentRun
	err := r.db.Where("run_id = ?", runID).First(&run).Error
	return run, err
}

// List 分页查询运行记录，支持按状态与关键词过滤，返回（当前页数据, 总数, 错误）。
func (r *Repository) List(page, pageSize int, status, keyword string) ([]model.AgentRun, int64, error) {
	q := r.db.Model(&model.AgentRun{})
	if status != "" {
		q = q.Where("status = ?", status)
	}
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		q = q.Where("run_id LIKE ? OR input LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []model.AgentRun
	if err := q.Order("created_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// UpdateStatus 仅更新某条运行记录的状态（如 queued -> running）。
func (r *Repository) UpdateStatus(runID, status string) error {
	return r.db.Model(&model.AgentRun{}).Where("run_id = ?", runID).Update("status", status).Error
}

// UpdateResult 回写一次运行的最终结果：状态、答案、错误信息、总耗时与结束时间。
func (r *Repository) UpdateResult(runID, status, final, errText string, durationMS int64, finished time.Time) error {
	return r.db.Model(&model.AgentRun{}).Where("run_id = ?", runID).Updates(map[string]any{
		"status":       status,
		"final_answer": final,
		"error":        errText,
		"duration_ms":  durationMS,
		"finished_at":  finished,
	}).Error
}

// MarkCancelled 将运行记录标记为已取消，并记录结束时间。
func (r *Repository) MarkCancelled(run *model.AgentRun, finished time.Time) error {
	return r.db.Model(run).Updates(map[string]any{"status": "cancelled", "finished_at": finished}).Error
}

// CreateTrace 向数据库插入一条执行轨迹事件。
func (r *Repository) CreateTrace(ev *model.TraceEvent) error { return r.db.Create(ev).Error }

// ListTrace 按 run_id 读取本地保存的执行轨迹事件，按 seq、created_at 升序返回。
func (r *Repository) ListTrace(runID string) ([]model.TraceEvent, error) {
	var items []model.TraceEvent
	err := r.db.Where("run_id = ?", runID).Order("seq asc, created_at asc").Find(&items).Error
	return items, err
}

// Stats 汇总运行记录的各状态数量，并取最近 limit 条记录，供仪表盘使用。
func (r *Repository) Stats(limit int) Stats {
	var s Stats
	r.db.Model(&model.AgentRun{}).Count(&s.Total)
	r.db.Model(&model.AgentRun{}).Where("status = ?", "succeeded").Count(&s.Success)
	r.db.Model(&model.AgentRun{}).Where("status = ?", "failed").Count(&s.Failed)
	r.db.Model(&model.AgentRun{}).Where("status IN ?", []string{"queued", "running"}).Count(&s.Running)
	r.db.Order("created_at desc").Limit(limit).Find(&s.Recent)
	return s
}
