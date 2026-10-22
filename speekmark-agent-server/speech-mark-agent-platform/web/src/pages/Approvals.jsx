import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Modal,
  Row,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  EyeOutlined,
  SafetyCertificateOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import StatusTag from '../components/StatusTag';
import { agentApi } from '../api/agent';
import { formatTime } from '../utils/format';
const { Text, Paragraph } = Typography;
// 人工审批页：列出需要人工确认的智能体动作，支持批准/拒绝（最终仍以后端校验为准）
export default function Approvals() {
  // items：待审批事项列表；loading：列表加载中
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  // selected：当前在抽屉里查看详情的审批项（null 表示未选中，抽屉关闭）
  const [selected, setSelected] = useState(null);
  // busy：提交审批决定的请求进行中标志，用于按钮 loading / 防止重复点击
  const [busy, setBusy] = useState(false);
  // 拉取待审批列表
  const load = () => {
    setLoading(true);
    agentApi
      .listApprovals()
      .then((r) => setItems(r.items || []))
      .finally(() => setLoading(false));
  };
  // 组件挂载时加载一次列表
  useEffect(() => {
    load();
  }, []);
  // 作出审批决定：decision 为 'approve' 或 'reject'，target 默认取当前选中项
  // 先弹确认框二次确认，确认后调用后端接口并刷新列表
  const decide = (decision, target = selected) => {
    if (!target) return;
    Modal.confirm({
      title: decision === 'approve' ? '确认批准此操作？' : '确认拒绝此操作？',
      content:
        decision === 'approve'
          ? '批准后，后端将根据审批策略继续执行对应动作。请确认内容、影响范围与权限。'
          : '拒绝后，该业务动作不应被执行。',
      okText: decision === 'approve' ? '确认批准' : '确认拒绝',
      okButtonProps: { danger: decision === 'reject', loading: busy },
      cancelText: '再检查一下',
      // 点击确认后执行：置 busy，调用后端提交决定，成功后关闭详情并刷新列表
      onOk: async () => {
        setBusy(true);
        try {
          await agentApi.decideApproval(target.id, decision);
          message.success(decision === 'approve' ? '审批已通过' : '已拒绝该申请');
          setSelected(null);
          load();
        } finally {
          setBusy(false);
        }
      },
    });
  };
  return (
    <div className="page-wrap">
      <PageHeader
        title="人工审批"
        subtitle="所有有副作用的 智能体动作都应经过后端授权与明确的人工确认。"
        extra={
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
        }
      />
      <div className="approval-banner">
        <div className="approval-banner-icon">
          <SafetyCertificateOutlined />
        </div>
        <div>
          <b>人工介入审批中心</b>
          <p>
            前端按钮仅提交审批决定；Go
            后端必须重新验证操作者身份、权限、审批状态与幂等性，不能相信前端传来的角色信息。
          </p>
        </div>
      </div>
      <Row gutter={[16, 16]}>
        {/* 遍历待审批项，每项渲染成一张卡片 */}
        {items.map((item) => (
          <Col xs={24} xl={12} key={item.id}>
            <Card bordered={false} className="approval-card" loading={loading}>
              <div className="approval-card-top">
                <Tag color="purple" bordered={false}>
                  {item.type}
                </Tag>
                <StatusTag status={item.status} />
              </div>
              <h3>{item.title}</h3>
              <Paragraph type="secondary">{item.summary}</Paragraph>
              <div className="approval-meta">
                <div>
                  <span>申请人</span>
                  <b>{item.requester}</b>
                </div>
                <div>
                  <span>提交时间</span>
                  <b>{formatTime(item.created_at)}</b>
                </div>
                <div>
                  <span>风险等级</span>
                  <Tag color={item.risk === 'medium' ? 'orange' : 'green'}>
                    {item.risk === 'medium' ? '中风险' : '低风险'}
                  </Tag>
                </div>
              </div>
              <div className="approval-actions">
                {/* 查看详情：把当前项写入 selected，触发右侧抽屉打开 */}
                <Button icon={<EyeOutlined />} onClick={() => setSelected(item)}>
                  查看详情
                </Button>
                <Space>
                  {/* 只有状态为 pending 的项才允许拒绝/批准 */}
                  <Button
                    disabled={item.status !== 'pending'}
                    danger
                    icon={<CloseOutlined />}
                    onClick={() => decide('reject', item)}
                  >
                    拒绝
                  </Button>
                  <Button
                    type="primary"
                    disabled={item.status !== 'pending'}
                    icon={<CheckOutlined />}
                    onClick={() => decide('approve', item)}
                  >
                    批准
                  </Button>
                </Space>
              </div>
            </Card>
          </Col>
        ))}
        {/* 加载结束且列表为空时显示空状态提示 */}
        {!loading && items.length === 0 && (
          <Col span={24}>
            <Card bordered={false}>
              <div className="approval-empty">
                <SafetyCertificateOutlined />
                <b>当前没有待审批事项</b>
                <Text type="secondary">智能体生成的业务动作草稿会显示在这里。</Text>
              </div>
            </Card>
          </Col>
        )}
      </Row>
      {/* 详情抽屉：open 由 selected 是否有值决定；仅 pending 项在右上角显示操作按钮 */}
      <Drawer
        title="审批详情"
        open={!!selected}
        onClose={() => setSelected(null)}
        width={560}
        extra={
          selected?.status === 'pending' && (
            <Space>
              <Button danger onClick={() => decide('reject')}>
                拒绝
              </Button>
              <Button type="primary" onClick={() => decide('approve')}>
                批准
              </Button>
            </Space>
          )
        }
      >
        <Descriptions
          column={1}
          items={[
            { key: 'id', label: '审批 ID', children: selected?.id },
            { key: 'title', label: '动作名称', children: selected?.title },
            { key: 'type', label: '动作类型', children: selected?.type },
            { key: 'requester', label: '申请来源', children: selected?.requester },
            { key: 'time', label: '提交时间', children: formatTime(selected?.created_at) },
            { key: 'risk', label: '风险等级', children: selected?.risk },
            {
              key: 'status',
              label: '当前状态',
              children: selected && <StatusTag status={selected.status} />,
            },
          ]}
        />
        <Card size="small" title="动作摘要" className="approval-summary">
          {selected?.summary}
        </Card>
        <div className="approval-safety-note">
          审批只是业务流程中的一个检查点。执行动作前仍需在 Go
          服务端做权限、参数、数据范围和重复提交检查。
        </div>
      </Drawer>
    </div>
  );
}
