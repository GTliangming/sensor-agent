// Package health 是“健康检查”业务线的特性包：liveness 不依赖外部资源，
// readiness 通过 service 探测数据库连通性。
package health

import (
	"context"

	"gorm.io/gorm"
)

// Service 持有数据库句柄，用于就绪探测。
type Service struct{ db *gorm.DB }

// NewService 构造健康检查服务，注入 GORM 句柄。
func NewService(db *gorm.DB) *Service { return &Service{db: db} }

// Ping 探测数据库是否可用：拿到底层连接并在给定 ctx 下 Ping，失败返回 error。
func (s *Service) Ping(ctx context.Context) error {
	sqlDB, err := s.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.PingContext(ctx)
}
