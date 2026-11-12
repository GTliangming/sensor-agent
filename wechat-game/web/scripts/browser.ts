import { chromium, type Browser } from "playwright-core";

/**
 * 启动本机已安装的 Chrome（无头）。不下载 Playwright 自带浏览器。
 * 用 SwiftShader 软件渲染，保证没有 GPU 的环境里 WebGL 也能跑。
 */
export function launchChrome(): Promise<Browser> {
  return chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
}
