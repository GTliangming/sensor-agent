import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles/global.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#625bf6', colorInfo: '#625bf6', borderRadius: 10, fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif', colorBgLayout: '#f5f6fa', controlHeight: 38 }, components: { Menu: { itemHeight: 44, itemBorderRadius: 9 }, Table: { headerBg: '#f8f9fc' } } }}>
      <AntApp><BrowserRouter><App /></BrowserRouter></AntApp>
    </ConfigProvider>
  </React.StrictMode>
);
