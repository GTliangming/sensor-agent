import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Input,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  ArrowUpOutlined,
  RobotOutlined,
  UserOutlined,
  PlusOutlined,
  PaperClipOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  ToolOutlined,
  CheckCircleOutlined,
  StopOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import StatusTag from '../components/StatusTag';
import { agentApi } from '../api/agent';
import { formatTime, formatDuration } from '../utils/format';
const { Text, Paragraph } = Typography;
// 欢迎页预置的示例问题，点击后可直接发起一次智能体运行
const suggestions = [
  '查询当前待质检任务最多的三个项目',
  '分析本周语音标注项目的质检情况',
  '根据 SOP 解释什么是切分边界错误',
  '生成本周质量分析报告草稿',
];
// 智能体对话页：左侧聊天发起任务，右侧实时展示执行轨迹（节点/工具调用）
export default function Assistant() {
  // input：输入框文本；busy：是否有任务正在创建或执行（用于禁用按钮、显示停止）
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // run：当前运行详情对象；trace：执行轨迹事件数组（setEvents 是它的 setter）
  const [run, setRun] = useState(null);
  const [trace, setEvents] = useState([]);
  // history：本次会话发起过的任务列表（最多保留 8 条）
  const [history, setHistory] = useState([]);
  // mode：运行模式（快速/均衡/严谨），随请求一起发给后端
  const [mode, setMode] = useState('balanced');
  // pollRef：保存轮询定时器 id；用 ref 是为了跨渲染持有且修改它不触发重渲染
  const pollRef = useRef(null);
  const navigate = useNavigate();
  // 组件卸载时清掉轮询定时器，避免离开页面后仍在后台请求（返回的函数即清理逻辑）
  useEffect(() => () => clearInterval(pollRef.current), []);
  // 发起一次智能体运行；text 默认取输入框内容，也可由示例问题直接传入
  const startRun = async (text = input) => {
    // 空内容或正忙时不处理
    if (!text.trim() || busy) return;
    setBusy(true);
    setInput('');
    setRun(null);
    setEvents([]);
    try {
      // 1) 创建运行，拿到 run_id；2) 查运行详情；3) 查执行轨迹
      const created = await agentApi.createRun({ input: text.trim(), mode });
      const detail = await agentApi.getRun(created.run_id);
      const events = await agentApi.getTrace(created.run_id);
      setRun(detail);
      setEvents(events.events || []);
      // 把这次任务插到历史列表最前面，去重后只保留最近 8 条
      setHistory((old) =>
        [
          { run_id: created.run_id, input: text.trim(), status: detail.status || 'running' },
          ...old.filter((x) => x.run_id !== created.run_id),
        ].slice(0, 8)
      );
      message.success('任务已提交');
      // 若任务还在排队/执行，则启动轮询定时器，每 1.8s 刷新一次状态与轨迹
      if (['queued', 'running'].includes(detail.status)) {
        pollRef.current = setInterval(async () => {
          try {
            const fresh = await agentApi.getRun(created.run_id);
            setRun(fresh);
            const next = await agentApi.getTrace(created.run_id);
            setEvents(next.events || []);
            // 到达终态（成功/失败/取消/待审批）即停止轮询并解除忙碌状态
            if (['succeeded', 'failed', 'cancelled', 'waiting_approval'].includes(fresh.status)) {
              clearInterval(pollRef.current);
              setBusy(false);
            }
          } catch {
            // 轮询请求出错时也停止轮询，避免反复失败
            clearInterval(pollRef.current);
            setBusy(false);
          }
        }, 1800);
      } else setBusy(false);
    } catch {
      // 创建/查询阶段出错，解除忙碌状态
      setBusy(false);
    }
  };
  // 取消当前运行：通知后端取消，停止轮询，并把本地状态标记为已取消
  const cancel = async () => {
    if (!run?.run_id) return;
    try {
      await agentApi.cancelRun(run.run_id);
      clearInterval(pollRef.current);
      setRun({ ...run, status: 'cancelled' });
      setBusy(false);
      message.info('已请求取消任务');
    } catch {}
  };
  // 根据状态返回标签颜色（失败红 / 执行中蓝 / 其它绿）
  const statusColor = (s) => (s === 'failed' ? 'red' : s === 'running' ? 'processing' : 'green');
  return (
    <div className="page-wrap assistant-page">
      <PageHeader
        title="智能体对话"
        subtitle="通过自然语言发起业务查询，实时查看工具调用与执行轨迹。"
        extra={
          <Button
            icon={<PlusOutlined />}
            onClick={() => {
              setRun(null);
              setEvents([]);
              setInput('');
            }}
          >
            新建会话
          </Button>
        }
      />
      <Alert
        className="dev-alert"
        type="warning"
        showIcon
        message="请勿在输入框中粘贴真实敏感数据"
        description="当前页面用于学习和开发验证。智能体输出是辅助分析结果，真实业务操作必须经过后端权限校验与人工审批。"
        closable
      />
      <div className="assistant-grid">
        <Card bordered={false} className="chat-card">
          <div className="chat-head">
            <div className="assistant-avatar">
              <RobotOutlined />
            </div>
            <div>
              <b>标注业务智能体</b>
              <div>
                <span className="online-dot" /> <Text type="secondary">开发环境 · 可用</Text>
              </div>
            </div>
            <div className="chat-head-right">
              <Tag bordered={false} color="purple">
                LangGraph
              </Tag>
              {/* 运行模式下拉：选中值绑定 mode，切换时发起新任务会带上该模式 */}
              <Select
                size="small"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'fast', label: '快速模式' },
                  { value: 'balanced', label: '均衡模式' },
                  { value: 'careful', label: '严谨模式' },
                ]}
                style={{ width: 110 }}
              />
            </div>
          </div>
          <div className="chat-messages">
            {/* 无运行且不忙时：显示欢迎语与示例问题（初始空态） */}
            {!run && !busy && (
              <div className="welcome-state">
                <div className="welcome-icon">
                  <RobotOutlined />
                </div>
                <TitleText>你好，我是标注业务智能体</TitleText>
                <Text type="secondary">
                  你可以让我查询项目数据、分析质检情况，或从业务知识库中查找标准。提交后可以在右侧观察每一步执行过程。
                </Text>
                <div className="suggestion-grid">
                  {/* 把示例问题渲染成按钮，点击直接用该问题发起运行 */}
                  {suggestions.map((s, i) => (
                    <button key={s} className="suggestion" onClick={() => startRun(s)}>
                      <span>{['⌕', '◉', '▤', '✧'][i]}</span>
                      {s}
                      <ArrowUpOutlined />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* 有运行时：依次渲染“用户提问气泡”和“智能体回答气泡” */}
            {run && (
              <>
                <div className="message-row user-message">
                  <Avatar icon={<UserOutlined />} className="user-avatar" />
                  <div className="message-bubble user-bubble">
                    <div className="message-meta">
                      你 <span>{formatTime(run.started_at)}</span>
                    </div>
                    {run.input}
                  </div>
                </div>
                <div className="message-row agent-message">
                  <Avatar icon={<RobotOutlined />} className="agent-avatar-small" />
                  <div className="message-bubble agent-bubble">
                    <div className="message-meta">
                      标注业务智能体 <StatusTag status={run.status} />
                    </div>
                    {/* 有最终答案则展示答案，否则显示执行中的加载动画 */}
                    {run.final_answer ? (
                      <Paragraph className="answer-text">{run.final_answer}</Paragraph>
                    ) : (
                      <div className="thinking">
                        <Spin size="small" />
                        <span>正在执行工作流，收集业务数据并生成结果…</span>
                      </div>
                    )}
                    {/* 执行出错时显示错误信息 */}
                    {run.error && (
                      <Alert type="error" showIcon message="任务执行失败" description={run.error} />
                    )}
                    <div className="answer-footer">
                      <span>
                        <ClockCircleOutlined /> {formatDuration(run.duration_ms)}
                      </span>
                      <span>
                        <ToolOutlined /> {run.tools ?? trace.filter((x) => x.tool_call_id).length}{' '}
                        次工具调用
                      </span>
                      <span>
                        <ThunderboltOutlined /> {run.tokens ?? '—'} tokens
                      </span>
                      {run.run_id && (
                        <Button
                          type="link"
                          size="small"
                          onClick={() => navigate(`/runs/${run.run_id}`)}
                        >
                          打开完整详情
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
            {/* 正在创建运行（还没拿到 run）时的过渡加载态 */}
            {busy && !run && (
              <div className="initial-loading">
                <Spin />
                <span>正在创建智能体运行任务…</span>
              </div>
            )}
          </div>
          <div className="chat-composer">
            {/* 输入区：绑定 input；回车发送，Shift+Enter 换行；忙碌时禁用 */}
            <Input.TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  startRun();
                }
              }}
              placeholder="描述你要完成的业务任务…（Enter 发送，Shift + Enter 换行）"
              autoSize={{ minRows: 2, maxRows: 5 }}
              disabled={busy}
            />
            <div className="composer-toolbar">
              <div>
                <Button type="text" icon={<PaperClipOutlined />} disabled>
                  添加上下文（后续开放）
                </Button>
                <Text type="secondary" className="composer-tip">
                  智能体可能产生不准确的分析，请核对关键数据
                </Text>
              </div>
              <Space>
                {/* 发送按钮：输入为空或忙碌时禁用 */}
                <Button
                  type="primary"
                  icon={<ArrowUpOutlined />}
                  onClick={() => startRun()}
                  disabled={!input.trim() || busy}
                >
                  发送
                </Button>
                {/* 任务执行中才显示“停止”按钮，点击取消当前运行 */}
                {busy && (
                  <Button danger icon={<StopOutlined />} onClick={cancel}>
                    停止
                  </Button>
                )}
              </Space>
            </div>
          </div>
        </Card>
        <div className="trace-column">
          {/* 右侧执行轨迹卡片：展示本次运行的节点、工具调用与耗时 */}
          <Card bordered={false} className="trace-card">
            <div className="trace-heading">
              <div>
                <TitleText>执行轨迹</TitleText>
                <Text type="secondary">执行过程详情</Text>
              </div>
              {run && <StatusTag status={run.status} />}
            </div>
            {!run && (
              <div className="trace-empty">
                <div className="trace-empty-icon">
                  <ThunderboltOutlined />
                </div>
                <b>等待执行任务</b>
                <Text type="secondary">
                  提交问题后，这里会展示节点流转、工具调用、耗时与结果摘要。
                </Text>
              </div>
            )}
            {run && (
              <>
                <div className="trace-metrics">
                  <div>
                    <span>节点数</span>
                    <b>{trace.length}</b>
                  </div>
                  <div>
                    <span>耗时</span>
                    <b>{formatDuration(run.duration_ms)}</b>
                  </div>
                  <div>
                    <span>工具</span>
                    <b>{trace.filter((x) => x.tool_call_id).length}</b>
                  </div>
                </div>
                <div className="trace-timeline">
                  {/* 把每个轨迹事件渲染成一个时间线节点；根据事件类型选择图标与样式 */}
                  {trace.map((evt, i) => (
                    <div className="trace-event" key={evt.event_id || i}>
                      <div
                        className={`trace-node ${evt.type?.startsWith('tool') ? 'tool-node' : evt.type?.includes('completed') ? 'done-node' : ''}`}
                      >
                        {evt.type?.startsWith('tool') ? (
                          <ToolOutlined />
                        ) : evt.type?.includes('completed') ? (
                          <CheckCircleOutlined />
                        ) : (
                          <ThunderboltOutlined />
                        )}
                      </div>
                      <div className="trace-event-body">
                        <div className="trace-event-top">
                          <b>{evt.title || evt.node}</b>
                          <Text type="secondary">{formatDuration(evt.duration_ms)}</Text>
                        </div>
                        <div className="trace-node-name">{evt.node}</div>
                        <div className="trace-event-detail">{evt.detail}</div>
                        {/* 工具类事件额外展示“工具调用”标签与调用 id */}
                        {evt.tool_call_id && (
                          <div className="tool-meta">
                            <Tag bordered={false} color="blue">
                              工具调用
                            </Tag>
                            <code>{evt.tool_call_id}</code>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  block
                  icon={<FileTextOutlined />}
                  onClick={() => navigate(`/runs/${run.run_id}`)}
                >
                  查看完整 执行轨迹 详情
                </Button>
              </>
            )}
          </Card>
          <Card bordered={false} className="recent-chat-card" title="最近任务">
            <div className="recent-chat-list">
              {/* 历史为空给出提示；否则逐条列出，点击跳转到对应运行详情页 */}
              {history.length === 0 ? (
                <Text type="secondary">本次会话的任务会显示在这里。</Text>
              ) : (
                history.map((h) => (
                  <button key={h.run_id} onClick={() => navigate(`/runs/${h.run_id}`)}>
                    <span className="recent-chat-dot" />
                    <span className="recent-chat-text">
                      <b>{h.input}</b>
                      <small>{h.run_id}</small>
                    </span>
                    <StatusTag status={h.status} />
                  </button>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
function TitleText({ children }) {
  return <div className="title-text">{children}</div>;
}
