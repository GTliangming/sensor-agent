// Package repository 是运行记录的数据访问层（Repository 模式）。
// 它把所有对 AgentRun 表的数据库读写集中封装在一处，上层（service/handler）
// 只调用这里的方法，而不直接拼 SQL。这样类似 Python 里把 ORM 查询收敛到一个
// DAO/Repository 类中，便于复用和测试。底层通过 GORM 操作 SQLite。
package repository

import (
	"strings"

	"example.com/speech-mark-agent-platform/backend-go/internal/model"
	"gorm.io/gorm"
)

// RunRepository 持有一个 *gorm.DB 连接（相当于 Python 里持有一个数据库会话/Session），
// 所有查询都基于它发起。
type RunRepository struct{ db *gorm.DB }

// NewRunRepository 是构造函数：注入 GORM 的数据库句柄并返回仓储实例。
// Go 没有类构造器，习惯上用 NewXxx 函数来完成依赖注入。
func NewRunRepository(db *gorm.DB) *RunRepository { return &RunRepository{db: db} }

// Create 向数据库插入一条新的运行记录；返回的 error 为 nil 表示写入成功。
func (r *RunRepository) Create(run *model.AgentRun) error { return r.db.Create(run).Error }

// GetByRunID 按业务主键 run_id 查询单条运行记录。
// 使用占位符 ? 传参（参数化查询），可避免 SQL 注入；First 取第一条，
// 查不到时会返回 gorm.ErrRecordNotFound 错误。
func (r *RunRepository) GetByRunID(runID string) (model.AgentRun, error) {
	var run model.AgentRun
	err := r.db.Where("run_id = ?", runID).First(&run).Error
	return run, err
}

// List 分页查询运行记录，支持按状态与关键词过滤，返回（当前页数据, 符合条件的总数, 错误）。
// 整体流程：先按条件拼查询 -> 统计总数 -> 再取当前页数据。
func (r *RunRepository) List(page, pageSize int, status, keyword string) ([]model.AgentRun, int64, error) {
	// 以 AgentRun 为查询模型起步，后续按需追加 where 条件（链式构建，尚未真正执行 SQL）。
	q := r.db.Model(&model.AgentRun{})
	// 传了 status 时按状态精确过滤。
	if status != "" {
		q = q.Where("status = ?", status)
	}
	// 传了关键词时去除首尾空白，再对 run_id 或 input 做模糊匹配（LIKE）。
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		q = q.Where("run_id LIKE ? OR input LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}
	// 先在相同过滤条件下统计总条数，供前端计算总页数。
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	// 再取当前页：按创建时间倒序，用 Offset/Limit 做分页（Offset = 跳过前面几页的数据量）。
	var items []model.AgentRun
	if err := q.Order("created_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}
