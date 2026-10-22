package database

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"example.com/speech-mark-agent-platform/backend-go/internal/config"
	"example.com/speech-mark-agent-platform/backend-go/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func Open(cfg config.Config) (*gorm.DB, error) {
	level := logger.Warn
	if cfg.GinMode == "debug" {
		level = logger.Info
	}
	gormCfg := &gorm.Config{Logger: logger.Default.LogMode(level)}
	var db *gorm.DB
	var err error
	switch cfg.DatabaseDriver {
	case "sqlite", "":
		if cfg.SQLitePath != ":memory:" {
			if err = os.MkdirAll(filepath.Dir(cfg.SQLitePath), 0o755); err != nil {
				return nil, fmt.Errorf("创建 SQLite 数据目录失败: %w", err)
			}
		}
		db, err = gorm.Open(sqlite.Open(cfg.SQLitePath), gormCfg)
	default:
		return nil, fmt.Errorf("不支持的 DATABASE_DRIVER: %s（当前仅支持 sqlite）", cfg.DatabaseDriver)
	}
	if err != nil {
		return nil, err
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(1) // SQLite 单文件开发模式，避免并发写锁冲突
	sqlDB.SetMaxIdleConns(1)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	if err = sqlDB.Ping(); err != nil {
		return nil, err
	}
	if err = db.AutoMigrate(&model.AgentRun{}, &model.TraceEvent{}, &model.Approval{}); err != nil {
		return nil, fmt.Errorf("自动迁移失败: %w", err)
	}
	return db, nil
}
