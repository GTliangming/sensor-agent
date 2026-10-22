// App.jsx：应用的路由中心，负责把不同的 URL 路径映射到对应的页面组件
// （类比 Python Web 框架里的「路由表」，比如 Flask 的 @app.route 集合）

// 从 react-router-dom 引入路由相关组件：
// Routes 是路由容器，Route 定义单条路由规则，Navigate 用于重定向跳转
import { Navigate, Route, Routes } from 'react-router-dom';
// 整体布局组件（侧边栏 + 顶栏 + 内容区的外壳）
import MainLayout from './layouts/MainLayout';
// 下面这些都是具体的页面组件，每个对应一个功能界面
import Dashboard from './pages/Dashboard';
import Assistant from './pages/Assistant';
import Runs from './pages/Runs';
import RunDetail from './pages/RunDetail';
import Approvals from './pages/Approvals';
import Knowledge from './pages/Knowledge';
import Settings from './pages/Settings';

// App 是整个前端应用的根组件（相当于程序入口处的主函数）
export default function App() {
  return (
    // Routes 内部会根据当前浏览器地址，自动选中并渲染匹配的那条 Route
    <Routes>
      {/* 父路由只渲染 MainLayout 外壳，子路由的页面会显示在布局的内容区中 */}
      <Route element={<MainLayout />}>
        {/* path 是 URL 路径，element 是该路径下要显示的页面组件 */}
        <Route path="/" element={<Dashboard />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/runs" element={<Runs />} />
        {/* :runId 是路径参数（动态段），页面内可读取它来加载对应的运行详情 */}
        <Route path="/runs/:runId" element={<RunDetail />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/knowledge" element={<Knowledge />} />
        <Route path="/settings" element={<Settings />} />
        {/* path="*" 匹配所有未定义的路径，统一重定向回首页（replace 表示不留历史记录） */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
