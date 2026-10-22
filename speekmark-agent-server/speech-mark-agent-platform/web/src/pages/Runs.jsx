import { useEffect, useState } from 'react';
import { Button, Card, Input, Select, Space, Table, Typography, Tooltip } from 'antd';
import { SearchOutlined, ReloadOutlined, EyeOutlined, MessageOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import StatusTag from '../components/StatusTag';
import { agentApi } from '../api/agent';
import { formatTime, formatDuration } from '../utils/format';
const { Text } = Typography;
// 运行记录页面：以表格列出所有运行任务，支持按关键词搜索和按状态筛选。
export default function Runs() {
  // data：当前展示的运行记录列表。
  const [data, setData] = useState([]);
  // loading：表格加载态。
  const [loading, setLoading] = useState(true);
  // keyword：搜索框输入的关键词（任务内容或运行编号）。
  const [keyword, setKeyword] = useState('');
  // status：下拉选中的状态筛选值，未选时为 undefined（表示全部）。
  const [status, setStatus] = useState();
  const navigate = useNavigate();
  // load：按当前关键词与状态向后端请求运行列表并刷新表格；查询/筛选/刷新都会调用它。
  const load = () => {
    setLoading(true);
    agentApi
      .listRuns({ keyword, status, page: 1, page_size: 20 })
      .then((r) => setData(r.items || []))
      .finally(() => setLoading(false));
  };
  // 首次加载以及每当 status 变化时自动重新查询（依赖数组里有 status）。
  useEffect(() => {
    load();
  }, [status]);
  // columns：运行记录表格的列定义。
  const columns = [
    {
      title: '运行编号 / 任务内容',
      dataIndex: 'input',
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
      width: '42%',
    },
    // 状态列：渲染为带颜色的状态标签。
    { title: '状态', dataIndex: 'status', render: (v) => <StatusTag status={v} />, width: 110 },
    // 开始时间列：直接把 formatTime 作为渲染函数，格式化时间戳。
    { title: '开始时间', dataIndex: 'started_at', render: formatTime, width: 180 },
    // 耗时列：格式化毫秒耗时。
    { title: '耗时', dataIndex: 'duration_ms', render: formatDuration, width: 100 },
    {
      title: '节点 / 工具',
      // 自定义列：没有单一 dataIndex，直接从整行 r 读取节点数与工具数，缺失时显示占位符。
      render: (_, r) => (
        <span>
          {r.steps ?? '—'} / {r.tools ?? '—'}
        </span>
      ),
      width: 120,
    },
    // 令牌列：把 token 数字转成带千分位的文本，无值时显示占位符。
    { title: '令牌', dataIndex: 'tokens', render: (v) => v?.toLocaleString() || '—', width: 100 },
    {
      title: '操作',
      // 操作列：点击"详情"跳转到该运行的详情页。
      render: (_, r) => (
        <Tooltip title="查看执行详情">
          <Button type="text" icon={<EyeOutlined />} onClick={() => navigate(`/runs/${r.run_id}`)}>
            详情
          </Button>
        </Tooltip>
      ),
      width: 100,
    },
  ];
  return (
    <div className="page-wrap">
      <PageHeader
        title="运行记录"
        subtitle="统一查看 运行任务状态、耗时、工具调用数量与最终结果。"
        extra={
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
        }
      />
      <Card bordered={false} className="table-card">
        <div className="table-toolbar">
          <Space wrap>
            {/* 搜索框：输入时更新 keyword 状态，按回车触发查询。 */}
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索任务内容或 运行编号"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onPressEnter={load}
              style={{ width: 290 }}
            />
            {/* 状态下拉：选择后更新 status，由上面的 useEffect 自动触发重新查询。 */}
            <Select
              allowClear
              placeholder="全部状态"
              value={status}
              onChange={setStatus}
              style={{ width: 150 }}
              options={[
                { value: 'succeeded', label: '成功' },
                { value: 'running', label: '运行中' },
                { value: 'failed', label: '失败' },
                { value: 'waiting_approval', label: '待审批' },
                { value: 'cancelled', label: '已取消' },
              ]}
            />
            <Button type="primary" onClick={load}>
              查询
            </Button>
          </Space>
          <Text type="secondary">共 {data.length} 条记录（当前开发数据集）</Text>
        </div>
        <Table
          rowKey="run_id"
          dataSource={data}
          columns={columns}
          loading={loading}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
          scroll={{ x: 1000 }}
        />
      </Card>
    </div>
  );
}
