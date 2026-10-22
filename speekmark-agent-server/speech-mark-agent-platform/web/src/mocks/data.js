import dayjs from 'dayjs';
const now = dayjs();
export const mockRuns = [
  { run_id: 'run_20261022_001', input: '帮我分析一下本周语音标注项目的质检情况，并找出异常项目', status: 'succeeded', started_at: now.subtract(8, 'minute').toISOString(), finished_at: now.subtract(7, 'minute').toISOString(), duration_ms: 48200, final_answer: '本周共分析 12 个项目。项目「普通话长语音-第三批」质检驳回率达到 8.6%，高于 5% 的预警线，建议优先检查切分边界和漏标问题。', steps: 7, tools: 3, tokens: 3421 },
  { run_id: 'run_20261022_002', input: '查询当前待质检任务最多的三个项目', status: 'running', started_at: now.subtract(40, 'second').toISOString(), duration_ms: 40000, steps: 4, tools: 2, tokens: 1210 },
  { run_id: 'run_20261021_019', input: '根据质检 SOP 解释什么情况下属于语义错误', status: 'succeeded', started_at: now.subtract(2, 'hour').toISOString(), finished_at: now.subtract(2, 'hour').add(11, 'second').toISOString(), duration_ms: 11200, final_answer: '根据当前版本 SOP，语义错误指文本内容与原始音频表达的语义不一致，包括关键词遗漏、否定词错误和实体替换等。', steps: 5, tools: 1, tokens: 1840 },
  { run_id: 'run_20261021_018', input: '统计昨天各个项目的验收通过率', status: 'failed', started_at: now.subtract(4, 'hour').toISOString(), finished_at: now.subtract(4, 'hour').add(3, 'second').toISOString(), duration_ms: 3200, error: 'BUSINESS_API_TIMEOUT：查询项目验收统计超时，请稍后重试。', steps: 3, tools: 1, tokens: 540 },
  { run_id: 'run_20261021_017', input: '帮我生成本周质量分析报告草稿', status: 'waiting_approval', started_at: now.subtract(1, 'day').toISOString(), finished_at: now.subtract(1, 'day').add(2, 'minute').toISOString(), duration_ms: 126000, final_answer: '已生成质量分析报告草稿，等待负责人审核后发布。', steps: 9, tools: 4, tokens: 6021 }
];
export const mockTrace = [
  { event_id: 'evt_01', sequence: 1, type: 'run.started', node: '入口', title: '收到用户请求', detail: '解析用户目标并创建本次 智能体运行任务。', status: 'succeeded', timestamp: now.subtract(8, 'minute').toISOString(), duration_ms: 3 },
  { event_id: 'evt_02', sequence: 2, type: 'agent.plan', node: '意图识别', title: '识别为质量分析任务', detail: '需要查询项目列表、质检统计，并依据预警规则做对比。', status: 'succeeded', timestamp: now.subtract(8, 'minute').add(120, 'millisecond').toISOString(), duration_ms: 820 },
  { event_id: 'evt_03', sequence: 3, type: 'tool.started', node: 'list_projects', title: '调用工具：查询项目', detail: 'GET /api/business/projects?page=1&page_size=50', status: 'succeeded', timestamp: now.subtract(8, 'minute').add(1, 'second').toISOString(), duration_ms: 240, tool_call_id: 'tool_01', input: { page: 1, page_size: 50 }, output: { total: 12, returned: 12 } },
  { event_id: 'evt_04', sequence: 4, type: 'tool.started', node: 'get_quality_stats', title: '调用工具：查询质检统计', detail: '按本周时间范围获取项目维度统计数据。', status: 'succeeded', timestamp: now.subtract(8, 'minute').add(2, 'second').toISOString(), duration_ms: 680, tool_call_id: 'tool_02', input: { period: 'this_week', dimensions: ['project', 'reject_rate'] }, output: { projects: 12, warning_threshold: 0.05 } },
  { event_id: 'evt_05', sequence: 5, type: 'agent.analysis', node: '规则分析', title: '对比质检预警线', detail: '将项目驳回率与业务阈值比较，标记超过阈值的项目。', status: 'succeeded', timestamp: now.subtract(8, 'minute').add(3, 'second').toISOString(), duration_ms: 1200 },
  { event_id: 'evt_06', sequence: 6, type: 'tool.started', node: 'search_sop', title: '检索质量标准', detail: '检索与切分边界、漏标相关的 SOP 片段。', status: 'succeeded', timestamp: now.subtract(8, 'minute').add(4, 'second').toISOString(), duration_ms: 410, tool_call_id: 'tool_03', input: { query: '切分边界 漏标 质检驳回' }, output: { chunks: 3, top_score: 0.91 } },
  { event_id: 'evt_07', sequence: 7, type: 'run.completed', node: '最终回答', title: '生成分析结论', detail: '结论包含统计口径、异常项目和建议动作。', status: 'succeeded', timestamp: now.subtract(7, 'minute').toISOString(), duration_ms: 960 }
];
export const mockStats = { totalRuns: 1284, successRate: 96.8, avgDuration: 18.6, toolCalls: 3821, daily: [{ day: '10/16', runs: 120 }, { day: '10/17', runs: 146 }, { day: '10/18', runs: 132 }, { day: '10/19', runs: 188 }, { day: '10/20', runs: 164 }, { day: '10/21', runs: 205 }, { day: '10/22', runs: 179 }], statuses: [{ type: '成功', value: 1120 }, { type: '失败', value: 48 }, { type: '运行中', value: 22 }, { type: '待审批', value: 16 }] };
export const mockApprovals = [
  { id: 'apr_001', title: '本周语音标注质量分析报告', type: '报告发布', requester: 'Agent · Quality Analyst', created_at: now.subtract(18, 'minute').toISOString(), status: 'pending', risk: 'medium', summary: '包含 12 个项目的质检统计，指出 2 个高风险项目，并给出整改建议。' },
  { id: 'apr_002', title: '创建项目异常复盘任务', type: '创建业务任务', requester: 'Agent · Project 智能体对话', created_at: now.subtract(3, 'hour').toISOString(), status: 'pending', risk: 'low', summary: '根据近期驳回率生成复盘任务草稿，尚未写入正式业务数据。' }
];
export const mockKnowledge = [
  { id: 'doc_001', title: '语音标注质检规范 V3.2', category: '质检规范', chunks: 42, updated_at: '2026-10-12', status: '已索引', description: '覆盖漏标、错标、切分边界、说话人标签等判定标准。' },
  { id: 'doc_002', title: '长语音标注 SOP', category: '操作流程', chunks: 28, updated_at: '2026-10-09', status: '已索引', description: '长音频标注的处理流程、复核节点和常见问题。' },
  { id: 'doc_003', title: '项目验收规则说明', category: '验收规则', chunks: 16, updated_at: '2026-10-03', status: '处理中', description: '各验收阶段的准入标准、驳回原因及处理方式。' }
];
