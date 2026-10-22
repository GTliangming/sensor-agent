// Package client 封装了对 Python Agent 服务的 HTTP 调用。
// 本文件相当于 Python 里的一个 requests/httpx 封装类：
// 负责拼接 Agent 服务的 URL、发请求、把 JSON 编解码成 Go 的 map，
// 并把 HTTP 层面的错误统一转换成 error 返回给上层。
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// AgentClient 是调用 Python Agent 服务的客户端。
// BaseURL 是 Agent 服务的根地址（如 http://127.0.0.1:8000）；
// HTTP 是底层的 http.Client，统一持有超时等配置，便于复用连接。
type AgentClient struct {
	BaseURL string
	HTTP    *http.Client
}

// New 构造一个 AgentClient。
// base 为 Agent 服务根地址，timeout 为单次请求的整体超时时间，
// 超时会设置在 http.Client 上，之后每个请求都受其约束。
func New(base string, timeout time.Duration) *AgentClient {
	return &AgentClient{BaseURL: base, HTTP: &http.Client{Timeout: timeout}}
}

// CreateRun 调用 Agent 的 POST /v1/runs 接口创建一次运行。
// payload 会被序列化为 JSON 作为请求体；成功时返回解析后的 JSON（map）。
// ctx 用于传递超时/取消信号；当返回的 HTTP 状态码 >= 300 时返回错误。
func (c *AgentClient) CreateRun(ctx context.Context, payload any) (map[string]any, error) {
	b, _ := json.Marshal(payload) // 把入参编码成 JSON 字节
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/v1/runs", bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTP.Do(req) // 发送请求（受 ctx 与 client 超时约束）
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close() // 函数返回前关闭响应体，避免连接泄漏
	var out map[string]any
	if err = json.NewDecoder(resp.Body).Decode(&out); err != nil { // 解析 JSON 响应
		return nil, err
	}
	if resp.StatusCode >= 300 { // 非 2xx 一律视为失败
		return nil, fmt.Errorf("Agent 服务返回 HTTP %d", resp.StatusCode)
	}
	return out, nil
}

// GetRun 调用 Agent 的 GET /v1/runs/{id} 接口查询某次运行的状态与结果。
// id 为运行 ID，直接拼接到 URL 路径中；成功时返回解析后的 JSON（map）。
// 当返回的 HTTP 状态码 >= 300 时返回错误。
func (c *AgentClient) GetRun(ctx context.Context, id string) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+"/v1/runs/"+id, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close() // 函数返回前关闭响应体
	var out map[string]any
	if err = json.NewDecoder(resp.Body).Decode(&out); err != nil { // 解析 JSON 响应
		return nil, err
	}
	if resp.StatusCode >= 300 { // 非 2xx 视为失败
		return nil, fmt.Errorf("Agent 服务返回 HTTP %d", resp.StatusCode)
	}
	return out, nil
}

// GetTrace 调用 Agent 的 GET /v1/runs/{id}/trace 接口获取运行的执行轨迹。
// id 为运行 ID，拼接到 URL 路径中；成功时返回解析后的 JSON（map）。
// 当返回的 HTTP 状态码 >= 300 时返回错误。
func (c *AgentClient) GetTrace(ctx context.Context, id string) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+"/v1/runs/"+id+"/trace", nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close() // 函数返回前关闭响应体
	var out map[string]any
	if err = json.NewDecoder(resp.Body).Decode(&out); err != nil { // 解析 JSON 响应
		return nil, err
	}
	if resp.StatusCode >= 300 { // 非 2xx 视为失败
		return nil, fmt.Errorf("Agent 服务返回 HTTP %d", resp.StatusCode)
	}
	return out, nil
}
