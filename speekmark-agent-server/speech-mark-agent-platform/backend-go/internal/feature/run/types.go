// 本文件集中定义 run 业务线的包内类型：请求体、统计结构与哨兵错误。
// 这些类型在包内（controller/service/repository）直接共享，无需跨包导出。
package run

import (
	"errors"

	"example.com/speech-mark-agent-platform/backend-go/internal/model"
)

// 以下哨兵错误供 controller 判断并映射为对应的 HTTP 状态码，
// 避免 service 直接依赖 Web 层的状态码概念。
var (
	// ErrInvalidMode 表示运行模式非法（仅支持 fast/balanced/careful）。
	ErrInvalidMode = errors.New("mode 仅支持 fast、balanced、careful")
	// ErrNotFound 表示按 run_id 未找到运行记录。
	ErrNotFound = errors.New("运行任务不存在")
	// ErrNotCancellable 表示当前状态不允许取消。
	ErrNotCancellable = errors.New("当前任务状态不允许取消")
)

// createRequest 是“创建运行任务”接口的请求体。
// binding 标签由 Gin 做入参校验：input 必填且长度 1~12000，mode 可选。
type createRequest struct {
	Input string `json:"input" binding:"required,min=1,max=12000"`
	Mode  string `json:"mode"`
}

// Stats 汇总运行记录的统计信息，供仪表盘展示。
type Stats struct {
	Total   int64            // 运行总数
	Success int64            // 成功数
	Failed  int64            // 失败数
	Running int64            // 进行中（queued + running）
	Recent  []model.AgentRun // 最近若干条记录
}

// simpleError 是把字符串直接当作 error 的最小实现（Go 里 error 是接口，需实现 Error 方法）。
type simpleError string

func (e simpleError) Error() string { return string(e) }

// stringError 把一段文字包装成 error；文字为空时给出默认提示。
func stringError(s string) error {
	if s == "" {
		s = "Python Agent 执行失败"
	}
	return simpleError(s)
}
