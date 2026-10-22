// Package database 负责建立数据库连接并完成建表。
// 使用 GORM（Go 的 ORM，类似 Python 的 SQLAlchemy）操作 SQLite 单文件数据库，
// 并通过 AutoMigrate 根据 model 结构体自动创建/更新表结构。
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

// Open 根据配置打开数据库连接，设置连接池与日志级别，并自动建表，返回可用的 *gorm.DB。
func Open(cfg config.Config) (*gorm.DB, error) {
	// 非 debug 模式下只打印 Warn 及以上日志，debug 模式打印全部 SQL（Info 级别），便于开发调试。
	level := logger.Warn
	if cfg.GinMode == "debug" {
		level = logger.Info
	}
	gormCfg := &gorm.Config{Logger: logger.Default.LogMode(level)}
	var db *gorm.DB
	var err error
	// 根据配置的数据库驱动选择实现；目前只支持 sqlite（空字符串也按 sqlite 处理）。
	switch cfg.DatabaseDriver {
	case "sqlite", "":
		// 当不是内存数据库时，先确保 SQLite 文件所在目录存在（0o755 为目录权限）。
		if cfg.SQLitePath != ":memory:" {
			if err = os.MkdirAll(filepath.Dir(cfg.SQLitePath), 0o755); err != nil {
				return nil, fmt.Errorf("创建 SQLite 数据目录失败: %w", err)
			}
		}
		// 打开（或创建）SQLite 文件并建立 GORM 连接。
		db, err = gorm.Open(sqlite.Open(cfg.SQLitePath), gormCfg)
	default:
		// 遇到不支持的驱动直接返回错误。
		return nil, fmt.Errorf("不支持的 DATABASE_DRIVER: %s（当前仅支持 sqlite）", cfg.DatabaseDriver)
	}
	if err != nil {
		return nil, err
	}
	// 取出底层的 *sql.DB 以便配置连接池参数。
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(1) // SQLite 单文件开发模式，避免并发写锁冲突
	sqlDB.SetMaxIdleConns(1)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	// Ping 验证数据库确实可连通。
	if err = sqlDB.Ping(); err != nil {
		return nil, err
	}
	// 根据 model 结构体自动创建/更新对应的表（AgentRun、TraceEvent、Approval）。
	if err = db.AutoMigrate(&model.AgentRun{}, &model.TraceEvent{}, &model.Approval{}); err != nil {
		return nil, fmt.Errorf("自动迁移失败: %w", err)
	}
	return db, nil
}
