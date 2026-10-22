// main.jsx：前端应用的启动入口（类比 Python 的 if __name__ == '__main__'）
// 职责：把根组件 App 挂载到页面上，并统一配置 Ant Design 的主题与中文语言包

import React from 'react';
// createRoot 是 React 18+ 的渲染入口，用来把组件树渲染进真实 DOM
import { createRoot } from 'react-dom/client';
// ConfigProvider 用于全局配置 antd；App 在此改名为 AntApp，避免和自己的 App 组件重名
import { ConfigProvider, App as AntApp } from 'antd';
// antd 的简体中文语言包，让组件内置文案显示为中文
import zhCN from 'antd/locale/zh_CN';
// BrowserRouter 提供基于浏览器 history 的路由能力，是使用 Routes/Route 的前提
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
// 引入全局样式（一旦 import，样式就会对整个应用生效）
import './styles/global.css';

// 找到 index.html 中 id 为 root 的空节点，作为整个应用的挂载根节点，然后渲染组件树
createRoot(document.getElementById('root')).render(
  // StrictMode 是开发期的严格检查模式，用于提前暴露潜在问题（不影响线上表现）
  <React.StrictMode>
    {/* ConfigProvider：全局设置 antd 的语言和主题，内层所有组件都会继承这些配置 */}
    <ConfigProvider
      locale={zhCN}
      theme={{
        // token 是全局设计变量：主色、圆角、字体、控件高度等
        token: {
          colorPrimary: '#625bf6',
          colorInfo: '#625bf6',
          borderRadius: 10,
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
          colorBgLayout: '#f5f6fa',
          controlHeight: 38,
        },
        // components 针对具体组件做个性化微调（覆盖上面的全局 token）
        components: {
          Menu: { itemHeight: 44, itemBorderRadius: 9 },
          Table: { headerBg: '#f8f9fc' },
        },
      }}
    >
      {/* AntApp：antd 的应用容器，为 message/notification 等提供上下文 */}
      <AntApp>
        {/* BrowserRouter 包裹 App，使其内部的路由规则生效 */}
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
);
