import { defineConfig } from "vitest/config";

// 单元测试只覆盖纯逻辑与配置，不需要 React 插件
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
