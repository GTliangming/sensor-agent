import type { ThemeConfig } from 'antd';

export const appTheme: ThemeConfig = {
    token: {
        colorPrimary: '#2f6bff',
        colorInfo: '#2f6bff',
        borderRadius: 6,
        fontSize: 14,
        colorBgLayout: '#f5f7fa',
    },
    components: {
        Layout: {
            headerBg: '#ffffff',
            siderBg: '#ffffff',
            bodyBg: '#f5f7fa',
        },
        Menu: {
            itemSelectedBg: '#eef3ff',
            itemSelectedColor: '#2f6bff',
        },
    },
};
