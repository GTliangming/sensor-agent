package service

// Package service is the business orchestration layer. Keep HTTP-specific concerns
// (Gin Context, status codes, request binding) in handler; keep persistence in repository.
// The current scaffold's asynchronous Agent dispatch still lives in handler.go and is
// intentionally a first-step implementation. Move it here when adding durable queues,
// idempotency and cancellation propagation.
