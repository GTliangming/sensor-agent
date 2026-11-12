import { chromium, type Browser } from "playwright-core";

/**
 * 启动本机已安装的 Chrome（无头）。不下载 Playwright 自带浏览器。
 * 用 SwiftShader 软件渲染，保证没有 GPU 的环境里 WebGL 也能跑。
 * 本机没有 Chrome 时回落到 Playwright 自带的 chromium（npx playwright install chromium），
 * 行为一致，只用于本地 e2e；有 Chrome 的机器仍优先用 Chrome。
 */
export async function launchChrome(): Promise<Browser> {
  const args = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
  try {
    return await chromium.launch({ channel: "chrome", headless: true, args });
  } catch {
    return chromium.launch({ headless: true, args });
  }
}
