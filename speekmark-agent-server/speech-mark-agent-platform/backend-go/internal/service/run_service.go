package service

// 中文说明：本文件所在的 service 包是“业务编排层”，目前基本是占位/说明性文件。
// 职责定位：负责把一次完整的业务用例串起来（校验、调用 repository 读写数据、
// 协调多个步骤），对上屏蔽 HTTP 细节、对下屏蔽持久化细节。
//   - 它不该碰 Gin 的 Context、HTTP 状态码、请求体绑定这些 Web 相关的东西（放在 handler）。
//   - 它也不该直接拼 SQL（放在 repository）。
// 为什么异步调度仍暂放在 handler 里：当前仅为脚手架的第一步实现，Agent 的异步执行
// 直接写在 handler.go 中最简单直观；等到需要“持久化任务队列、幂等、取消信号透传”
// 这些更正式的能力时，再把这段调度逻辑迁移到本层统一编排。
// （以下英文注释为原有内容，保留不动。）

// Package service is the business orchestration layer. Keep HTTP-specific concerns
// (Gin Context, status codes, request binding) in handler; keep persistence in repository.
// The current scaffold's asynchronous Agent dispatch still lives in handler.go and is
// intentionally a first-step implementation. Move it here when adding durable queues,
// idempotency and cancellation propagation.
