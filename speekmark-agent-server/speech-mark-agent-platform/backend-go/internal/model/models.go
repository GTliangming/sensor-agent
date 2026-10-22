// Package model 定义平台使用的 GORM 数据模型（即数据库表结构）。
// 每个结构体对应一张表，字段上的 `gorm:"..."` 标签描述列的约束
// （类型、长度、索引、默认值等），`json:"..."` 标签描述序列化为
// JSON 时使用的字段名。GORM 类似 Python 的 SQLAlchemy ORM。
package model

import "time"

// AgentRun 表示一次 Agent 运行记录，对应数据库中的一张表。
// 保存运行的输入、模式、状态、最终结果以及耗时等统计信息。
type AgentRun struct {
	// ID 主键，自增；json:"-" 表示该字段不输出到 JSON
	ID uint64 `gorm:"primaryKey" json:"-"`
	// RunID 业务运行 ID；uniqueIndex 建唯一索引，size:64 限制列长，not null 非空
	RunID string `gorm:"size:64;uniqueIndex;not null" json:"run_id"`
	// Input 用户输入内容；type:text 存储长文本
	Input string `gorm:"type:text;not null" json:"input"`
	// Mode 运行模式；default:balanced 指定数据库默认值
	Mode string `gorm:"size:24;not null;default:balanced" json:"mode"`
	// Status 运行状态；index 建普通索引便于筛选，默认值 queued
	Status string `gorm:"size:32;index;not null;default:queued" json:"status"`
	// FinalAnswer 最终答案；longtext 为超长文本；omitempty 为空时不出现在 JSON 中
	FinalAnswer string `gorm:"type:longtext" json:"final_answer,omitempty"`
	// Error 错误信息，运行失败时填充；为空时不输出到 JSON
	Error string `gorm:"type:text" json:"error,omitempty"`
	// DurationMS 运行总耗时（毫秒）
	DurationMS int64 `json:"duration_ms"`
	// Steps 步骤数统计
	Steps int `json:"steps"`
	// Tools 工具调用次数统计
	Tools int `json:"tools"`
	// Tokens 消耗的 token 数统计
	Tokens int `json:"tokens"`
	// StartedAt 运行开始时间
	StartedAt time.Time `json:"started_at"`
	// FinishedAt 运行结束时间；指针类型可为 nil，对应数据库 NULL（表示未结束）
	FinishedAt *time.Time `json:"finished_at,omitempty"`
	// CreatedAt 记录创建时间，由 GORM 自动维护
	CreatedAt time.Time `json:"created_at"`
	// UpdatedAt 记录更新时间，由 GORM 自动维护
	UpdatedAt time.Time `json:"updated_at"`
}

// TraceEvent 表示一次运行中的单条执行轨迹事件（trace）。
// 一次运行会产生多条事件，按 Seq 顺序记录节点、工具调用等执行过程。
type TraceEvent struct {
	// ID 主键，自增；json:"-" 表示不输出到 JSON
	ID uint64 `gorm:"primaryKey" json:"-"`
	// EventID 事件业务 ID；uniqueIndex 建唯一索引
	EventID string `gorm:"size:64;uniqueIndex;not null" json:"event_id"`
	// RunID 所属运行的 ID；index 建普通索引，便于按运行聚合查询
	RunID string `gorm:"size:64;index;not null" json:"run_id"`
	// Seq 事件在本次运行中的顺序号
	Seq int `gorm:"not null" json:"seq"`
	// Type 事件类型（如节点、工具调用等）
	Type string `gorm:"size:64;not null" json:"type"`
	// Node 产生该事件的节点名
	Node string `gorm:"size:128" json:"node"`
	// Title 事件标题
	Title string `gorm:"size:255" json:"title"`
	// Detail 事件详情；type:text 存储长文本
	Detail string `gorm:"type:text" json:"detail"`
	// ToolCallID 关联的工具调用 ID；omitempty 为空时不输出到 JSON
	ToolCallID string `gorm:"size:64" json:"tool_call_id,omitempty"`
	// DurationMS 该事件耗时（毫秒）
	DurationMS int64 `json:"duration_ms"`
	// InputSummary 输入摘要；type:text 长文本，为空时不输出到 JSON
	InputSummary string `gorm:"type:text" json:"input_summary,omitempty"`
	// OutputSummary 输出摘要；type:text 长文本，为空时不输出到 JSON
	OutputSummary string `gorm:"type:text" json:"output_summary,omitempty"`
	// Status 事件状态
	Status string `gorm:"size:32" json:"status"`
	// CreatedAt 记录创建时间，由 GORM 自动维护
	CreatedAt time.Time `json:"created_at"`
}

// Approval 表示一条审批记录，对应数据库中的一张表。
// 用于记录某次运行中需要人工审批的事项及其处理结果。
type Approval struct {
	// ID 主键，自增；这里 json:"id" 会输出到 JSON
	ID uint64 `gorm:"primaryKey" json:"id"`
	// ApprovalID 审批业务 ID；uniqueIndex 建唯一索引
	ApprovalID string `gorm:"size:64;uniqueIndex;not null" json:"approval_id"`
	// RunID 关联的运行 ID；index 建普通索引
	RunID string `gorm:"size:64;index;not null" json:"run_id"`
	// Title 审批标题
	Title string `gorm:"size:255" json:"title"`
	// Type 审批类型
	Type string `gorm:"size:100" json:"type"`
	// Requester 申请人
	Requester string `gorm:"size:128" json:"requester"`
	// Risk 风险等级
	Risk string `gorm:"size:24" json:"risk"`
	// Summary 摘要；type:text 存储长文本
	Summary string `gorm:"type:text" json:"summary"`
	// Description 详细描述；omitempty 为空时不输出到 JSON
	Description string `gorm:"type:text" json:"description,omitempty"`
	// Status 审批状态；index 建索引，默认值 pending（待处理）
	Status string `gorm:"size:32;index;not null;default:pending" json:"status"`
	// Comment 审批意见；为空时不输出到 JSON
	Comment string `gorm:"type:text" json:"comment,omitempty"`
	// CreatedAt 记录创建时间，由 GORM 自动维护
	CreatedAt time.Time `json:"created_at"`
	// UpdatedAt 记录更新时间，由 GORM 自动维护
	UpdatedAt time.Time `json:"updated_at"`
}
