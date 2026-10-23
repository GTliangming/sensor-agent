// 本文件为 approval 业务线的业务编排层：校验审批决定、保证只处理 pending 记录、
// 把 approve/reject 映射为落库状态。业务错误以哨兵错误形式返回给 controller。
package approval

import (
	"errors"

	"example.com/speech-mark-agent-platform/backend-go/internal/model"
)

// 以下哨兵错误供 controller 判断并映射为对应的 HTTP 状态码。
var (
	// ErrInvalidDecision 表示审批决定非法（仅支持 approve/reject）。
	ErrInvalidDecision = errors.New("decision 仅支持 approve 或 reject")
	// ErrNotFound 表示未找到审批记录。
	ErrNotFound = errors.New("审批记录不存在")
	// ErrAlreadyDecided 表示审批已处理，不能重复操作。
	ErrAlreadyDecided = errors.New("审批已处理，不能重复操作")
)

// Service 依赖审批仓储完成读写。
type Service struct{ repo *Repository }

// NewService 构造 approval.Service，注入审批仓储。
func NewService(repo *Repository) *Service { return &Service{repo: repo} }

// List 查询审批列表，可按 status 过滤。
func (s *Service) List(status string) ([]model.Approval, error) {
	return s.repo.List(status)
}

// Decide 处理一条审批：decision 仅支持 approve/reject，且只能处理 pending 记录。
// 返回审批业务 ID 与最终落库状态；各类业务错误以哨兵错误形式返回。
func (s *Service) Decide(id, decision, comment string) (string, string, error) {
	if decision != "approve" && decision != "reject" {
		return "", "", ErrInvalidDecision
	}
	item, err := s.repo.GetByID(id)
	if err != nil {
		return "", "", ErrNotFound
	}
	if item.Status != "pending" {
		return "", "", ErrAlreadyDecided
	}
	status := "approved"
	if decision == "reject" {
		status = "rejected"
	}
	if err := s.repo.UpdateDecision(&item, status, comment); err != nil {
		return "", "", err
	}
	return item.ApprovalID, status, nil
}
