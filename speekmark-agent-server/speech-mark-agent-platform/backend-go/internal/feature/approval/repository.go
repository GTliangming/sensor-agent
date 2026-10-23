// Package approval 是“审批（Approval）”业务线的特性包，内聚其全栈：
// controller、service、repository 与包内类型。
// 本文件为数据访问层：所有对 Approval 表的 SQL/GORM 操作收敛于此。
package approval

import (
	"example.com/speech-mark-agent-platform/backend-go/internal/model"
	"gorm.io/gorm"
)

// Repository 持有数据库句柄，负责审批记录的读写。
type Repository struct{ db *gorm.DB }

// NewRepository 构造审批仓储，注入 GORM 句柄。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// List 查询审批列表：status 非空时按状态过滤，统一按创建时间倒序返回。
func (r *Repository) List(status string) ([]model.Approval, error) {
	var items []model.Approval
	q := r.db.Order("created_at desc")
	if status != "" {
		q = q.Where("status = ?", status)
	}
	err := q.Find(&items).Error
	return items, err
}

// GetByID 按 approval_id 或主键 id 查找单条审批记录（兼容两种传入）。
func (r *Repository) GetByID(id string) (model.Approval, error) {
	var item model.Approval
	err := r.db.Where("approval_id = ? OR id = ?", id, id).First(&item).Error
	return item, err
}

// UpdateDecision 更新审批的处理结果：落库状态与审批备注。
func (r *Repository) UpdateDecision(item *model.Approval, status, comment string) error {
	return r.db.Model(item).Updates(map[string]any{"status": status, "comment": comment}).Error
}
