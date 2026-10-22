// 主布局组件：定义整个后台的外层框架（左侧导航 + 顶部栏 + 内容区 + 页脚）。
// 类比 Python：相当于一个「页面模板」，所有子页面都嵌在这里面渲染。
import { useState } from 'react'; // useState 是 React 的状态钩子，类似在类里保存一个可变的实例属性
import { Layout, Menu, Avatar, Dropdown, Typography, Button, Tooltip } from 'antd'; // 从 Ant Design 组件库按需引入 UI 组件
import {
  AppstoreOutlined,
  MessageOutlined,
  UnorderedListOutlined,
  SafetyCertificateOutlined,
  DatabaseOutlined,
  SettingOutlined,
  BellOutlined,
  SearchOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RobotOutlined,
  DownOutlined,
  GithubOutlined,
} from '@ant-design/icons'; // 以上是一批图标组件，每个对应导航或按钮上的小图标
// react-router 提供的路由工具：
// NavLink 带高亮的跳转链接；Outlet 子路由占位；useLocation 读当前路径；useNavigate 编程式跳转
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
// 从 Layout 中解构出三个子组件：Sider 侧边栏、Header 顶栏、Content 内容区
const { Sider, Header, Content } = Layout;
// 侧边导航菜单项配置：每项的 key 用于匹配当前路由，icon 是图标，label 是可点击的跳转链接
const menuItems = [
  { key: '/', icon: <AppstoreOutlined />, label: <NavLink to="/">工作台</NavLink> },
  {
    key: '/assistant',
    icon: <MessageOutlined />,
    label: <NavLink to="/assistant">智能对话</NavLink>,
  },
  { key: '/runs', icon: <UnorderedListOutlined />, label: <NavLink to="/runs">运行记录</NavLink> },
  {
    key: '/approvals',
    icon: <SafetyCertificateOutlined />,
    label: <NavLink to="/approvals">人工审批</NavLink>,
  },
  {
    key: '/knowledge',
    icon: <DatabaseOutlined />,
    label: <NavLink to="/knowledge">知识库</NavLink>,
  },
  {
    key: '/settings',
    icon: <SettingOutlined />,
    label: <NavLink to="/settings">系统配置</NavLink>,
  },
];
export default function MainLayout() {
  // collapsed 控制侧边栏是否收起；setCollapsed 是修改它的函数（类似 self.collapsed = ...）
  const [collapsed, setCollapsed] = useState(false);
  // 读取环境变量判断当前是否使用「模拟接口」（?? 表示取不到时默认 'true'）
  const isMock = String(import.meta.env.VITE_USE_MOCK ?? 'true') === 'true';
  const location = useLocation(); // 当前页面的路由信息（如 pathname）
  const navigate = useNavigate(); // 调用它可以跳转到其他页面
  // 计算当前应高亮的菜单项：
  // 取出所有 key，排除首页 '/'，保留与当前路径前缀匹配的项，按长度降序取最长匹配；都不匹配时回退到 '/'
  const selected =
    menuItems
      .map((x) => x.key)
      .filter((key) => key !== '/' && location.pathname.startsWith(key))
      .sort((a, b) => b.length - a.length)[0] || '/';
  // 下面 return 的是 JSX（类似带 HTML 结构的模板），整体布局：左侧 Sider + 右侧 Layout(顶栏/内容/页脚)
  return (
    <Layout className="app-layout">
      {/* 左侧侧边栏：含品牌标识、工作空间切换、导航菜单、底部环境信息 */}
      <Sider
        width={244}
        collapsedWidth={76}
        collapsed={collapsed}
        trigger={null}
        className="app-sider"
      >
        <div className="brand">
          <div className="brand-mark">
            <RobotOutlined />
          </div>
          {!collapsed && (
            <div className="brand-copy">
              <b>语音标注</b>
              <span>智能体工作台</span>
            </div>
          )}
        </div>
        <div className="workspace-switch">
          <div className="workspace-icon">SM</div>
          {!collapsed && (
            <>
              <div className="workspace-text">
                <b>语音标注平台</b>
                <span>开发工作空间</span>
              </div>
              <DownOutlined className="workspace-arrow" />
            </>
          )}
        </div>
        {!collapsed && <div className="menu-caption">工作空间</div>}
        {/* 导航菜单：selectedKeys 指定高亮项，items 为上面定义的 menuItems */}
        <Menu
          mode="inline"
          theme="dark"
          selectedKeys={[selected]}
          items={menuItems}
          className="main-menu"
        />
        {!collapsed && (
          <div className="sider-bottom">
            <div className="connection-dot" />
            <div>
              <b>开发环境</b>
              <span>{isMock ? '模拟接口已启用' : '已连接 Go 后端'}</span>
            </div>
            <span className="env-pill">DEV</span>
          </div>
        )}
      </Sider>
      {/* 右侧主区域：顶部栏 + 内容区 + 页脚 */}
      <Layout className="inner-layout">
        <Header className="top-header">
          <div className="header-left">
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)} // 点击切换侧边栏收起/展开
            />
            <span className="header-divider" />
            <Typography.Text type="secondary">智能体控制台</Typography.Text>
          </div>
          <div className="header-actions">
            <Tooltip title="快捷搜索">
              <Button type="text" icon={<SearchOutlined />} onClick={() => navigate('/runs')} />
            </Tooltip>
            <Tooltip title="通知">
              <Button type="text" icon={<BellOutlined />} />
            </Tooltip>
            <span className="header-divider" />
            <Dropdown
              menu={{
                items: [
                  { key: 'profile', label: '开发者账号' },
                  { key: 'settings', label: '系统配置', onClick: () => navigate('/settings') },
                ],
              }}
            >
              <button className="user-menu">
                <Avatar
                  size={30}
                  style={{ background: '#e8e7ff', color: '#5148d9', fontWeight: 700 }}
                >
                  D
                </Avatar>
                <span>开发者</span>
                <DownOutlined />
              </button>
            </Dropdown>
          </div>
        </Header>
        {/* 内容区：Outlet 是子路由的「占位符」，当前匹配到的页面会渲染在这里 */}
        <Content className="app-content">
          <Outlet />
        </Content>
        {/* 页脚信息 */}
        <div className="app-footer">
          <span>语音标注 智能体工作台 · 学习与开发环境</span>
          <span>
            <GithubOutlined /> 接口契约驱动 · 可观测 · 可审计
          </span>
        </div>
      </Layout>
    </Layout>
  );
}
