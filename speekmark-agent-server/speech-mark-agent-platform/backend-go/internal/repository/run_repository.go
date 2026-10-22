package repository

import (
	"strings"

	"example.com/speech-mark-agent-platform/backend-go/internal/model"
	"gorm.io/gorm"
)

type RunRepository struct{ db *gorm.DB }

func NewRunRepository(db *gorm.DB) *RunRepository         { return &RunRepository{db: db} }
func (r *RunRepository) Create(run *model.AgentRun) error { return r.db.Create(run).Error }
func (r *RunRepository) GetByRunID(runID string) (model.AgentRun, error) {
	var run model.AgentRun
	err := r.db.Where("run_id = ?", runID).First(&run).Error
	return run, err
}
func (r *RunRepository) List(page, pageSize int, status, keyword string) ([]model.AgentRun, int64, error) {
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
