import {
    BarChartOutlined,
    BookOutlined,
    DashboardOutlined,
    FileTextOutlined,
    HistoryOutlined,
    LogoutOutlined,
    MessageOutlined,
    SettingOutlined,
    UserOutlined,
} from '@ant-design/icons';
import { App, Avatar, Dropdown, Layout, Menu, Space, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { logout } from '@/services/auth';
import { useAuthStore } from '@/stores/auth';

const { Content, Header, Sider } = Layout;

const MENU_ITEMS: MenuProps['items'] = [
    { key: '/chat', icon: <MessageOutlined />, label: '智能对话' },
    { key: '/analytics', icon: <BarChartOutlined />, label: '数据分析' },
    { key: '/reports', icon: <FileTextOutlined />, label: '报告中心' },
    { key: '/knowledge', icon: <BookOutlined />, label: '知识库' },
    { key: '/history', icon: <HistoryOutlined />, label: '历史记录' },
    { type: 'divider' },
    { key: '/admin', icon: <SettingOutlined />, label: 'Agent 管理' },
    { key: '/monitor', icon: <DashboardOutlined />, label: '系统监控' },
];

const MENU_KEYS = [
    '/chat',
    '/analytics',
    '/reports',
    '/knowledge',
    '/history',
    '/admin',
    '/monitor',
];

export default function AppLayout() {
    const navigate = useNavigate();
    const location = useLocation();
    const { modal } = App.useApp();
    const user = useAuthStore(state => state.user);
    const clearAuth = useAuthStore(state => state.logout);

    const selectedKey = MENU_KEYS.find(key => location.pathname.startsWith(key)) ?? '/chat';

    const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
        navigate(key);
    };

    const handleLogout = () => {
        modal.confirm({
            title: '退出登录',
            content: '确定要退出当前账号吗？',
            okText: '退出',
            cancelText: '取消',
            onOk: async () => {
                try {
                    await logout();
                } finally {
                    clearAuth();
                    navigate('/login', { replace: true });
                }
            },
        });
    };

    return (
        <Layout className="app-layout">
            <Sider width={220} collapsible theme="light">
                <div className="app-sider__logo">
                    <span className="app-sider__logo-mark">A</span>
                    <span>Annotation Ops</span>
                </div>
                <Menu
                    mode="inline"
                    selectedKeys={[selectedKey]}
                    items={MENU_ITEMS}
                    onClick={handleMenuClick}
                    style={{ borderInlineEnd: 'none' }}
                />
            </Sider>
            <Layout>
                <Header className="app-header">
                    <Typography.Text className="app-header__title">
                        语音标注智能运营分析平台
                    </Typography.Text>
                    <Dropdown
                        menu={{
                            items: [
                                {
                                    key: 'logout',
                                    icon: <LogoutOutlined />,
                                    label: '退出登录',
                                    onClick: handleLogout,
                                },
                            ],
                        }}
                    >
                        <Space className="app-header__user" size={8}>
                            <Avatar size={28} icon={<UserOutlined />} />
                            <span>{user?.displayName ?? user?.username ?? '未登录'}</span>
                            <Tag color={user?.bound ? 'green' : 'orange'}>
                                {user?.bound ? '已绑定' : '未绑定'}
                            </Tag>
                        </Space>
                    </Dropdown>
                </Header>
                <Content className="app-content">
                    <Outlet />
                </Content>
            </Layout>
        </Layout>
    );
}
