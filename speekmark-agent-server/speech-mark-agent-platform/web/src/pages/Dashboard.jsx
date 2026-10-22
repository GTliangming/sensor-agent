import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Row, Space, Table, Typography, Progress, Tag } from 'antd';
import {
  ArrowRightOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  ApiOutlined,
  PlusOutlined,
  MessageOutlined,
  FileSearchOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import { Area, Pie } from '@ant-design/plots';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import StatusTag from '../components/StatusTag';
import { agentApi } from '../api/agent';
import { formatTime, formatDuration } from '../utils/format';
const { Text, Title } = Typography;
// 工作台（首页）页面：展示系统整体运行概览，包括统计卡片、趋势/状态图表与最近运行列表。
export default function Dashboard() {
  // 是否为"模拟数据"模式，读取构建环境变量 VITE_USE_MOCK（缺省按 'true' 处理，即默认用模拟数据）。
  const isMock = String(import.meta.env.VITE_USE_MOCK ?? 'true') === 'true';
  // useState 类似 Python 里"一个变量 + 修改它的函数"。stats 存仪表盘统计数据，setStats 用来更新它。
  const [stats, setStats] = useState(null);
  // runs 存最近运行记录列表，初始为空数组。
  const [runs, setRuns] = useState([]);
  // loading 表示数据是否还在加载中，用来给卡片/表格显示加载态。
  const [loading, setLoading] = useState(true);
  // navigate 用于编程式跳转路由（相当于点击链接切换页面）。
  const navigate = useNavigate();
  // useEffect 第二个参数为 []，表示"只在组件首次渲染后执行一次"，适合做初始化数据加载。
  useEffect(() => {
    // Promise.all 并行发起两个接口请求：仪表盘统计 + 最近 5 条运行记录，都成功后再统一更新状态。
    Promise.all([agentApi.dashboard(), agentApi.listRuns({ page: 1, page_size: 5 })])
      .then(([s, r]) => {
        setStats(s);
        setRuns(r.items || []);
      })
      // finally 无论成功或失败都会执行，这里统一关闭加载态。
      .finally(() => setLoading(false));
  }, []);
  // areaConfig：折线/面积图的配置对象，描述数据来源与样式（近 7 天运行趋势）。
  const areaConfig = {
    data: stats?.daily || [],
    xField: 'day',
    yField: 'runs',
    smooth: true,
    legend: false,
    areaStyle: { fill: 'l(270) 0:#625bf6 1:rgba(98,91,246,0.02)' },
    line: { style: { lineWidth: 2.5 } },
    point: { size: 3, shape: 'circle' },
    xAxis: { label: { style: { fill: '#8b90a3' } } },
    yAxis: { grid: { line: { style: { stroke: '#edf0f6', lineDash: [3, 3] } } } },
  };
  // pieConfig：环形饼图配置，展示各运行状态（成功/失败/运行中/待审批）的占比分布。
  const pieConfig = {
    data: stats?.statuses || [],
    angleField: 'value',
    colorField: 'type',
    radius: 0.86,
    innerRadius: 0.68,
    legend: { position: 'bottom' },
    label: { text: 'value', style: { fontWeight: 600 } },
    color: ['#625bf6', '#ff7777', '#36b37e', '#f3b64b'],
  };
  // columns：定义"最近运行"表格的列。每列的 render 决定该单元格如何渲染。
  const columns = [
    {
      title: '运行任务',
      dataIndex: 'input',
      // render(v, r)：v 是当前列的值（input），r 是整行数据；这里组合图标、标题与运行编号。
      render: (v, r) => (
        <div className="run-cell">
          <div className="run-cell-icon">
            <MessageOutlined />
          </div>
          <div>
            <div className="run-title">{v}</div>
            <Text type="secondary" className="run-id">
              {r.run_id}
            </Text>
          </div>
        </div>
      ),
      width: '48%',
    },
    // 状态列：用 StatusTag 把状态字符串渲染成带颜色的标签。
    { title: '状态', dataIndex: 'status', render: (v) => <StatusTag status={v} /> },
    // 耗时列：把毫秒数格式化为易读文本。
    { title: '耗时', dataIndex: 'duration_ms', render: (v) => formatDuration(v) },
    // 开始时间列：把时间戳格式化为日期时间。
    { title: '开始时间', dataIndex: 'started_at', render: (v) => formatTime(v) },
    {
      title: '操作',
      // 操作列：点击"查看详情"跳转到对应运行的详情页。
      render: (_, r) => (
        <Button type="link" onClick={() => navigate(`/runs/${r.run_id}`)}>
          查看详情 <ArrowRightOutlined />
        </Button>
      ),
    },
  ];
  return (
    // 页面整体结构：顶部标题栏 + 数据模式提示 + 统计卡片行 + 图表行 + 最近运行/快捷入口行。
    <div className="page-wrap">
      <PageHeader
        title="工作台"
        subtitle="欢迎回来，查看 智能体系统的运行状态与近期活动。"
        extra={
          <>
            <Button icon={<FileSearchOutlined />} onClick={() => navigate('/runs')}>
              查看运行记录
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/assistant')}>
              新建 智能体任务
            </Button>
          </>
        }
      />
      {/* 顶部提示条：根据 isMock 条件渲染不同文案，告知当前是模拟数据还是真实后端接口。 */}
      <Alert
        className="dev-alert"
        type="info"
        showIcon
        message={isMock ? '当前为模拟数据模式' : '当前为真实接口模式'}
        description={
          isMock
            ? '页面使用内置模拟数据，便于开发和验证交互。接入后端后，在 .env 中设置 VITE_USE_MOCK=false 即可切换真实接口。'
            : '页面已连接 Go 后端；若某项能力仍显示为空，可能是对应服务尚未实现。'
        }
        closable
      />
      <Row gutter={[16, 16]} className="stat-row">
        <Col xs={24} sm={12} xl={6}>
          <StatCard
            title="累计运行次数"
            value={stats?.totalRuns ?? '—'}
            hint="近 7 天持续增长"
            icon={<ThunderboltOutlined />}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard
            title="任务成功率"
            value={stats?.successRate ?? '—'}
            suffix="%"
            hint="成功 运行任务 / 已结束 运行任务"
            icon={<CheckCircleOutlined />}
            color="#20a779"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard
            title="平均执行耗时"
            value={stats?.avgDuration ?? '—'}
            suffix="s"
            hint="从开始到最终结果"
            icon={<ClockCircleOutlined />}
            color="#e9a23b"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard
            title="工具调用总数"
            value={stats?.toolCalls ?? '—'}
            hint="业务 API + 知识检索"
            icon={<ApiOutlined />}
            color="#3688f5"
          />
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card
            bordered={false}
            className="dashboard-card"
            title={
              <div className="card-title">
                <div>
                  <Title level={5}>运行趋势</Title>
                  <Text type="secondary">近 7 天 智能体运行任务 数量</Text>
                </div>
                <Tag bordered={false} color="purple">
                  最近 7 天
                </Tag>
              </div>
            }
            loading={loading}
          >
            <div className="chart-area">
              <Area {...areaConfig} />
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card
            bordered={false}
            className="dashboard-card"
            title={
              <div className="card-title">
                <div>
                  <Title level={5}>运行状态分布</Title>
                  <Text type="secondary">任务处理情况概览</Text>
                </div>
              </div>
            }
            loading={loading}
          >
            <div className="chart-pie">
              <Pie {...pieConfig} />
            </div>
            <div className="status-summary">
              <div>
                <span className="legend-dot success" />
                成功 <b>{stats?.statuses?.[0]?.value ?? 0}</b>
              </div>
              <div>
                <span className="legend-dot error" />
                失败 <b>{stats?.statuses?.[1]?.value ?? 0}</b>
              </div>
              <div>
                <span className="legend-dot running" />
                运行中 <b>{stats?.statuses?.[2]?.value ?? 0}</b>
              </div>
              <div>
                <span className="legend-dot waiting" />
                待审批 <b>{stats?.statuses?.[3]?.value ?? 0}</b>
              </div>
            </div>
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]} className="bottom-row">
        <Col xs={24} xl={16}>
          <Card
            bordered={false}
            className="dashboard-card"
            title={
              <div className="card-title">
                <div>
                  <Title level={5}>最近运行</Title>
                  <Text type="secondary">最近提交的 智能体任务及其执行结果</Text>
                </div>
                <Button type="link" onClick={() => navigate('/runs')}>
                  全部记录 <ArrowRightOutlined />
                </Button>
              </div>
            }
          >
            <Table
              rowKey="run_id"
              dataSource={runs}
              columns={columns}
              loading={loading}
              pagination={false}
              size="middle"
              scroll={{ x: 760 }}
            />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card
            bordered={false}
            className="dashboard-card quick-card"
            title={<Title level={5}>快捷入口</Title>}
          >
            <button className="quick-action" onClick={() => navigate('/assistant')}>
              <span className="quick-icon purple">
                <MessageOutlined />
              </span>
              <span>
                <b>开始智能对话</b>
                <small>用自然语言查询业务数据</small>
              </span>
              <ArrowRightOutlined />
            </button>
            <button className="quick-action" onClick={() => navigate('/approvals')}>
              <span className="quick-icon green">
                <CheckCircleOutlined />
              </span>
              <span>
                <b>处理人工审批</b>
                <small>查看等待确认的业务动作</small>
              </span>
              <ArrowRightOutlined />
            </button>
            <button className="quick-action" onClick={() => navigate('/knowledge')}>
              <span className="quick-icon blue">
                <FileSearchOutlined />
              </span>
              <span>
                <b>检索业务知识</b>
                <small>查看 SOP 与质检标准</small>
              </span>
              <ArrowRightOutlined />
            </button>
            <div className="health-box">
              <div className="health-head">
                <span>系统状态</span>
                <Tag color="success" bordered={false}>
                  正常
                </Tag>
              </div>
              <div className="health-item">
                <span>React 管理后台</span>
                <b>运行中</b>
              </div>
              <div className="health-item">
                <span>接口连接方式</span>
                <b>{isMock ? '模拟数据适配器' : 'Go 后端接口'}</b>
              </div>
              <Progress percent={100} showInfo={false} strokeColor="#20a779" size="small" />
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
