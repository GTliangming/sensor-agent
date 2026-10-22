import { useState } from 'react';
import { Layout, Menu, Avatar, Dropdown, Typography, Button, Tooltip } from 'antd';
import { AppstoreOutlined, MessageOutlined, UnorderedListOutlined, SafetyCertificateOutlined, DatabaseOutlined, SettingOutlined, BellOutlined, SearchOutlined, MenuFoldOutlined, MenuUnfoldOutlined, RobotOutlined, DownOutlined, GithubOutlined } from '@ant-design/icons';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
const { Sider, Header, Content } = Layout;
const menuItems = [
  { key: '/', icon: <AppstoreOutlined />, label: <NavLink to="/">工作台</NavLink> },
  { key: '/assistant', icon: <MessageOutlined />, label: <NavLink to="/assistant">智能对话</NavLink> },
  { key: '/runs', icon: <UnorderedListOutlined />, label: <NavLink to="/runs">运行记录</NavLink> },
  { key: '/approvals', icon: <SafetyCertificateOutlined />, label: <NavLink to="/approvals">人工审批</NavLink> },
  { key: '/knowledge', icon: <DatabaseOutlined />, label: <NavLink to="/knowledge">知识库</NavLink> },
  { key: '/settings', icon: <SettingOutlined />, label: <NavLink to="/settings">系统配置</NavLink> }
];
export default function MainLayout() {
  const [collapsed, setCollapsed] = useState(false); const isMock = String(import.meta.env.VITE_USE_MOCK ?? 'true') === 'true'; const location = useLocation(); const navigate = useNavigate();
  const selected = menuItems.map(x => x.key).filter(key => key !== '/' && location.pathname.startsWith(key)).sort((a,b)=>b.length-a.length)[0] || '/';
  return <Layout className="app-layout">
    <Sider width={244} collapsedWidth={76} collapsed={collapsed} trigger={null} className="app-sider">
      <div className="brand"><div className="brand-mark"><RobotOutlined /></div>{!collapsed && <div className="brand-copy"><b>语音标注</b><span>智能体工作台</span></div>}</div>
      <div className="workspace-switch"><div className="workspace-icon">SM</div>{!collapsed && <><div className="workspace-text"><b>语音标注平台</b><span>开发工作空间</span></div><DownOutlined className="workspace-arrow" /></>}</div>
      {!collapsed && <div className="menu-caption">工作空间</div>}
      <Menu mode="inline" theme="dark" selectedKeys={[selected]} items={menuItems} className="main-menu" />
      {!collapsed && <div className="sider-bottom"><div className="connection-dot" /><div><b>开发环境</b><span>{isMock ? '模拟接口已启用' : '已连接 Go 后端'}</span></div><span className="env-pill">DEV</span></div>}
    </Sider>
    <Layout className="inner-layout">
      <Header className="top-header"><div className="header-left"><Button type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} /><span className="header-divider"/><Typography.Text type="secondary">智能体控制台</Typography.Text></div><div className="header-actions"><Tooltip title="快捷搜索"><Button type="text" icon={<SearchOutlined />} onClick={() => navigate('/runs')} /></Tooltip><Tooltip title="通知"><Button type="text" icon={<BellOutlined />} /></Tooltip><span className="header-divider"/><Dropdown menu={{ items: [{ key: 'profile', label: '开发者账号' }, { key: 'settings', label: '系统配置', onClick: () => navigate('/settings') }] }}><button className="user-menu"><Avatar size={30} style={{ background: '#e8e7ff', color: '#5148d9', fontWeight: 700 }}>D</Avatar><span>开发者</span><DownOutlined /></button></Dropdown></div></Header>
      <Content className="app-content"><Outlet /></Content>
      <div className="app-footer"><span>语音标注 智能体工作台 · 学习与开发环境</span><span><GithubOutlined /> 接口契约驱动 · 可观测 · 可审计</span></div>
    </Layout>
  </Layout>;
}
