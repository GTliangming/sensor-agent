// Package server 封装 HTTP 服务的启动与优雅关闭逻辑。
// 这部分是与具体业务无关的通用模板：在后台启动监听，收到中断信号后给在途请求留出时间再退出。
// 把它从 main 里抽离，入口只需专注“装配好路由后交给 server 运行”。
package server

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// Run 启动传入的 HTTP Server 并阻塞，直到收到 SIGINT/SIGTERM 后执行优雅关闭。
// 监听失败（非主动关闭）会直接终止进程；关闭阶段的错误只记录日志，不影响退出。
func Run(srv *http.Server) {
	// 在单独的 goroutine（轻量级协程）中启动服务，使 Run 不被阻塞，可继续等待退出信号。
	go func() {
		log.Printf("Go API listening on %s", srv.Addr)
		// ListenAndServe 正常会一直阻塞；主动关闭时返回 ErrServerClosed，属预期不算错误。
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP 服务异常: %v", err)
		}
	}()

	// 监听系统中断信号（Ctrl+C 的 SIGINT、kill 的 SIGTERM），用于触发优雅关闭。
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	// 阻塞在此，直到从 stop 通道收到信号为止。
	<-stop

	// 给正在处理的请求最多 10 秒时间完成，超时则强制结束。
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// 优雅关闭：停止接收新请求并等待已有请求处理完成。
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("优雅关闭失败: %v", err)
	}
}
