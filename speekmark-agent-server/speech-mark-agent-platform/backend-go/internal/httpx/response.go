// Package httpx 提供跨业务线复用的统一 HTTP 响应辅助函数。
// 各业务包的 controller 都通过这里返回成功/失败响应，保证响应结构一致：
// 成功为 {data, request_id}，失败为 {error:{code,message}, request_id}。
package httpx

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// OK 是统一的“成功响应”：固定返回 200，把业务数据放在 data 字段，
// 并带上本次请求的 request_id（由 RequestID 中间件写入上下文）。
func OK(c *gin.Context, data any) {
	c.JSON(http.StatusOK, gin.H{"data": data, "request_id": c.GetString("request_id")})
}

// Fail 是统一的“失败响应”：用指定 HTTP 状态码返回，
// error 里含机器可读的 code 与给用户看的 message，并同样附带 request_id。
func Fail(c *gin.Context, status int, code, msg string) {
	c.JSON(status, gin.H{"error": gin.H{"code": code, "message": msg}, "request_id": c.GetString("request_id")})
}
