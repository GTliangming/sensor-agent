import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Row,
  Space,
  Tabs,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  ToolOutlined,
  CopyOutlined,
  CodeOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import StatusTag from '../components/StatusTag';
import { agentApi } from '../api/agent';
import { formatTime, formatDuration } from '../utils/format';
const { Text, Paragraph } = Typography;
// 运行详情页面：展示单次运行的概览信息、执行轨迹时间线，以及工具调用的输入/输出。
export default function RunDetail() {
  // 从路由参数中取出 runId（URL 形如 /runs/:runId），用它去请求对应运行的数据。
  const { runId } = useParams();
  const navigate = useNavigate();
  // run：运行主体信息（状态、耗时、输入、最终回答等）。
  const [run, setRun] = useState(null);
  // events：执行轨迹中的事件列表（每个节点/工具调用一条）。
  const [events, setEvents] = useState([]);
  // loading：页面加载态。
  const [loading, setLoading] = useState(true);
  // selected：当前在抽屉里查看的事件；为 null 时抽屉关闭。
  const [selected, setSelected] = useState(null);
  // load：并行拉取运行详情与执行轨迹，刷新页面数据。
  const load = () => {
    setLoading(true);
    Promise.all([agentApi.getRun(runId), agentApi.getTrace(runId)])
      .then(([r, t]) => {
        setRun(r);
        setEvents(t.events || []);
      })
      .finally(() => setLoading(false));
  };
  // 当 runId 变化时（切换查看不同运行）重新加载数据。
  useEffect(() => {
    load();
  }, [runId]);
  // copy：把对象序列化为格式化 JSON 并写入系统剪贴板，便于复制调试信息。
  const copy = (obj) => navigator.clipboard?.writeText(JSON.stringify(obj, null, 2));
  // items：把后端事件列表转换成 Timeline 组件需要的结构（标题、内容、节点图标）。
  const items = events.map((e, i) => ({
    key: e.event_id || i,
    label: (
      <div className="timeline-label">
        <b>{e.title || e.node}</b>
        <Text type="secondary">{formatDuration(e.duration_ms)}</Text>
      </div>
    ),
    children: (
      <div className="detail-event">
        <Tag bordered={false} color={e.tool_call_id ? 'blue' : 'default'}>
          {e.node}
        </Tag>
        <Paragraph>{e.detail}</Paragraph>
        {/* 条件渲染：只有工具类事件（存在 tool_call_id）才显示"查看输入/输出"按钮。 */}
        {e.tool_call_id && (
          <Button size="small" onClick={() => setSelected(e)} icon={<CodeOutlined />}>
            查看输入 / 输出
          </Button>
        )}
      </div>
    ),
    // dot：根据事件类型选择时间线节点图标（工具/完成/其它）。
    dot: e.type?.startsWith('tool') ? (
      <ToolOutlined />
    ) : e.type?.includes('completed') ? (
      <CheckCircleOutlined />
    ) : (
      <ThunderboltOutlined />
    ),
  }));
  return (
    <div className="page-wrap">
      <PageHeader
        title="运行详情"
        subtitle={runId}
        breadcrumb={['工作空间', '运行记录', '运行详情']}
        extra={
          <>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/runs')}>
              返回列表
            </Button>
            <Button icon={<ReloadOutlined />} onClick={load}>
              刷新
            </Button>
          </>
        }
      />
      {/* 条件渲染：仅当该运行存在错误信息时，才在顶部显示红色错误提示。 */}
      {run?.error && (
        <Alert
          type="error"
          showIcon
          message="执行失败"
          description={run.error}
          className="detail-alert"
        />
      )}
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card
            bordered={false}
            loading={loading}
            className="detail-card"
            title="执行概览"
            extra={run && <StatusTag status={run.status} />}
          >
            {/* Descriptions：以"键-值"形式展示运行的各项元信息；?? 用于在字段缺失时回退计算值。 */}
            <Descriptions
              column={{ xs: 1, sm: 2 }}
              items={[
                { key: 'id', label: '运行编号', children: run?.run_id },
                { key: 'started', label: '开始时间', children: formatTime(run?.started_at) },
                { key: 'finished', label: '结束时间', children: formatTime(run?.finished_at) },
                { key: 'duration', label: '执行耗时', children: formatDuration(run?.duration_ms) },
                { key: 'steps', label: '执行节点', children: run?.steps ?? events.length },
                {
                  key: 'tools',
                  label: '工具调用',
                  children: run?.tools ?? events.filter((e) => e.tool_call_id).length,
                },
                {
                  key: 'tokens',
                  label: '模型令牌用量',
                  children: run?.tokens?.toLocaleString() || '—',
                },
              ]}
            />
            <div className="detail-question">
              <Text type="secondary">用户输入</Text>
              <Paragraph>{run?.input || '—'}</Paragraph>
            </div>
            {/* 条件渲染：有最终回答时才展示"最终回答"区块。 */}
            {run?.final_answer && (
              <div className="detail-answer">
                <div className="detail-answer-title">
                  <CheckCircleOutlined /> 最终回答
                </div>
                <Paragraph>{run.final_answer}</Paragraph>
              </div>
            )}
          </Card>
          <Card
            bordered={false}
            className="detail-card trace-detail-card"
            title="执行轨迹"
            extra={<Text type="secondary">{events.length} 个事件</Text>}
          >
            <Timeline items={items} />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card bordered={false} className="detail-card" title="运行元信息">
            <div className="metadata-list">
              <div>
                <span>执行状态</span>
                <StatusTag status={run?.status} />
              </div>
              <div>
                <span>
                  <ClockCircleOutlined /> 总耗时
                </span>
                <b>{formatDuration(run?.duration_ms)}</b>
              </div>
              <div>
                <span>
                  <ToolOutlined /> 工具调用
                </span>
                <b>{run?.tools ?? events.filter((e) => e.tool_call_id).length}</b>
              </div>
              <div>
                <span>
                  <ThunderboltOutlined /> 令牌
                </span>
                <b>{run?.tokens?.toLocaleString() || '—'}</b>
              </div>
            </div>
            <Button block icon={<CopyOutlined />} onClick={() => copy({ run, events })}>
              复制 运行记录与轨迹 JSON
            </Button>
          </Card>
          <Card bordered={false} className="detail-card" title="调试提示">
            <Alert
              type="info"
              showIcon
              message="先定位第一个异常节点"
              description="排查时按顺序核对：用户输入 → 智能体节点 → 工具入参 → Go 接口响应 → 状态更新 → 最终回答。不要只根据最终回答判断故障位置。"
            />
          </Card>
        </Col>
      </Row>
      {/* 抽屉：选中某个工具事件时（selected 非空）从右侧滑出，用 Tabs 分别展示输入参数与输出结果的 JSON。 */}
      <Drawer
        title="工具调用输入 / 输出"
        open={!!selected}
        onClose={() => setSelected(null)}
        width={560}
      >
        <Text type="secondary">
          {selected?.tool_call_id} · {selected?.node}
        </Text>
        <Tabs
          items={[
            {
              key: 'input',
              label: '输入参数',
              children: (
                <pre className="json-view">
                  {JSON.stringify(selected?.input ?? selected?.input_summary ?? {}, null, 2)}
                </pre>
              ),
            },
            {
              key: 'output',
              label: '输出结果',
              children: (
                <pre className="json-view">
                  {JSON.stringify(selected?.output ?? selected?.output_summary ?? {}, null, 2)}
                </pre>
              ),
            },
          ]}
        />
      </Drawer>
    </div>
  );
}
