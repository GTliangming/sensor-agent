// ESLint 扁平配置(Flat Config,ESLint 9 起的新格式):
// 默认导出一个数组,数组里每一项都是一段配置,按先后顺序叠加生效。
import js from '@eslint/js'; // ESLint 官方推荐规则集
import globals from 'globals'; // 预置的全局变量定义(browser / node 等)
import reactHooks from 'eslint-plugin-react-hooks'; // 校验 React Hooks 的用法
import reactRefresh from 'eslint-plugin-react-refresh'; // 配合热更新,检查组件导出方式
import prettier from 'eslint-config-prettier'; // 关闭与 Prettier 冲突的格式规则

export default [
  // 全局忽略:这些目录不参与 lint
  { ignores: ['dist', 'node_modules'] },
  {
    // 这段配置对所有 .js / .jsx 源文件生效
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022, // 允许使用的 JS 语法版本
      sourceType: 'module', // 以 ES Module(import/export)方式解析
      // 声明代码运行环境里存在哪些全局变量,避免它们被误报为「未定义」
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } }, // 开启 JSX 语法解析
    },
    // 启用的插件
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...js.configs.recommended.rules, // 继承官方推荐规则
      ...reactHooks.configs.recommended.rules, // 继承 React Hooks 推荐规则
      'no-unused-vars': 'off', // 关闭「未使用变量」报错(本项目暂不强制)
      // 组件文件只允许额外导出常量,否则会破坏热更新 —— 违反时给出警告
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  // 关闭与 Prettier 冲突的 ESLint 格式规则,格式统一交给 Prettier。
  // 必须放在数组最后,才能覆盖前面规则里的格式项。
  prettier,
];
