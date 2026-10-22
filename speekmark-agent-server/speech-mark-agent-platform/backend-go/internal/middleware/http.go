// Package middleware 存放 Gin 的 HTTP 中间件（相当于 Python Web 框架里的中间件/拦截器），
// 在请求进入业务 handler 之前统一做一些横切处理，比如注入请求 ID、处理跨域。
package middleware

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// RequestID 为每个请求注入唯一的 request_id：
// 若客户端带了 X-Request-ID 头就沿用，否则生成一个新的 UUID，
// 既存入上下文供后续 handler 使用，也写回响应头，方便全链路追踪与排查日志。
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader("X-Request-ID")
		if id == "" {
			id = uuid.NewString()
		}
		// 存入上下文，后续 handler 里用 c.GetString("request_id") 取用
		c.Set("request_id", id)
		// 回写响应头，方便前端拿到同一个请求 ID
		c.Header("X-Request-ID", id)
		// 放行到下一个中间件 / 业务 handler
		c.Next()
	}
}

// CORS 处理跨域资源共享（CORS）：允许任意来源的前端访问本 API，
// 并声明放行的请求头与方法；对浏览器的 OPTIONS 预检请求直接返回 204 结束。
func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID, X-Request-Source")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		// OPTIONS 是浏览器发起的预检请求，无需进入业务逻辑，直接返回 204
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}
