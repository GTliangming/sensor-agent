import '@ant-design/v5-patch-for-react-19';
import 'antd/dist/reset.css';
import './styles/global.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import { appTheme } from './styles/theme';

dayjs.locale('zh-cn');

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 30_000,
        },
    },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ConfigProvider locale={zhCN} theme={appTheme}>
            <AntdApp>
                <QueryClientProvider client={queryClient}>
                    <App />
                </QueryClientProvider>
            </AntdApp>
        </ConfigProvider>
    </React.StrictMode>
);
