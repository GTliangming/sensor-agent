package model

import "time"

type AgentRun struct {
	ID          uint64     `gorm:"primaryKey" json:"-"`
	RunID       string     `gorm:"size:64;uniqueIndex;not null" json:"run_id"`
	Input       string     `gorm:"type:text;not null" json:"input"`
	Mode        string     `gorm:"size:24;not null;default:balanced" json:"mode"`
	Status      string     `gorm:"size:32;index;not null;default:queued" json:"status"`
	FinalAnswer string     `gorm:"type:longtext" json:"final_answer,omitempty"`
	Error       string     `gorm:"type:text" json:"error,omitempty"`
	DurationMS  int64      `json:"duration_ms"`
	Steps       int        `json:"steps"`
	Tools       int        `json:"tools"`
	Tokens      int        `json:"tokens"`
	StartedAt   time.Time  `json:"started_at"`
	FinishedAt  *time.Time `json:"finished_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}
type TraceEvent struct {
	ID            uint64    `gorm:"primaryKey" json:"-"`
	EventID       string    `gorm:"size:64;uniqueIndex;not null" json:"event_id"`
	RunID         string    `gorm:"size:64;index;not null" json:"run_id"`
	Seq           int       `gorm:"not null" json:"seq"`
	Type          string    `gorm:"size:64;not null" json:"type"`
	Node          string    `gorm:"size:128" json:"node"`
	Title         string    `gorm:"size:255" json:"title"`
	Detail        string    `gorm:"type:text" json:"detail"`
	ToolCallID    string    `gorm:"size:64" json:"tool_call_id,omitempty"`
	DurationMS    int64     `json:"duration_ms"`
	InputSummary  string    `gorm:"type:text" json:"input_summary,omitempty"`
	OutputSummary string    `gorm:"type:text" json:"output_summary,omitempty"`
	Status        string    `gorm:"size:32" json:"status"`
	CreatedAt     time.Time `json:"created_at"`
}
type Approval struct {
	ID          uint64    `gorm:"primaryKey" json:"id"`
	ApprovalID  string    `gorm:"size:64;uniqueIndex;not null" json:"approval_id"`
	RunID       string    `gorm:"size:64;index;not null" json:"run_id"`
	Title       string    `gorm:"size:255" json:"title"`
	Type        string    `gorm:"size:100" json:"type"`
	Requester   string    `gorm:"size:128" json:"requester"`
	Risk        string    `gorm:"size:24" json:"risk"`
	Summary     string    `gorm:"type:text" json:"summary"`
	Description string    `gorm:"type:text" json:"description,omitempty"`
	Status      string    `gorm:"size:32;index;not null;default:pending" json:"status"`
	Comment     string    `gorm:"type:text" json:"comment,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
