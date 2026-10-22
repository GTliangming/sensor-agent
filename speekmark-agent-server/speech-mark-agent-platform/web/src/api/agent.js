import client from './client';
import { mockRuns, mockTrace, mockStats, mockApprovals, mockKnowledge } from '../mocks/data';
const MOCK = String(import.meta.env.VITE_USE_MOCK ?? 'true') === 'true';
const wait = (ms = 220) => new Promise((resolve) => setTimeout(resolve, ms));
const copy = (value) => JSON.parse(JSON.stringify(value));

export const agentApi = {
  async dashboard() { if (MOCK) { await wait(); return copy(mockStats); } const r = await client.get('/agent/dashboard'); return { totalRuns: r.total_runs ?? 0, successRate: Number((r.success_rate ?? 0).toFixed(1)), avgDuration: r.avg_duration ?? 0, toolCalls: r.tool_calls ?? 0, daily: r.daily ?? [], statuses: r.statuses ?? [{type:'成功',value:r.success_runs??0},{type:'失败',value:r.failed_runs??0},{type:'运行中',value:r.running_runs??0},{type:'待审批',value:0}] }; },
  async listRuns(params = {}) { if (MOCK) { await wait(); let items = copy(mockRuns); if (params.status) items = items.filter(x => x.status === params.status); if (params.keyword) items = items.filter(x => `${x.run_id} ${x.input}`.toLowerCase().includes(params.keyword.toLowerCase())); return { items, total: items.length, page: params.page || 1, page_size: params.page_size || 10 }; } return client.get('/agent/runs', { params }); },
  async createRun(payload) { if (MOCK) { await wait(350); const run = { run_id: `run_${Date.now()}`, input: payload.input, status: 'running', started_at: new Date().toISOString(), duration_ms: 0, steps: 1, tools: 0, tokens: 0 }; mockRuns.unshift(run); return { run_id: run.run_id, status: run.status }; } return client.post('/agent/runs', payload); },
  async getRun(id) { if (MOCK) { await wait(160); const run = mockRuns.find(x => x.run_id === id) || mockRuns[0]; if (run.status === 'running' && Date.now() - new Date(run.started_at).getTime() > 6500) { run.status = 'succeeded'; run.finished_at = new Date().toISOString(); run.duration_ms = Date.now() - new Date(run.started_at).getTime(); run.steps = 7; run.tools = 3; run.tokens = 2130; run.final_answer = '已完成模拟执行。正式接入后，这里将展示 Python Agent 基于 Go 业务 API 返回的真实数据生成的结论。'; } return copy(run); } return client.get(`/agent/runs/${id}`); },
  async getTrace(id) { if (MOCK) { await wait(180); return { run_id: id, events: copy(mockTrace) }; } return client.get(`/agent/runs/${id}/trace`); },
  async cancelRun(id) { if (MOCK) { await wait(); const run = mockRuns.find(x => x.run_id === id); if (run) run.status = 'cancelled'; return { run_id: id, status: 'cancelled' }; } return client.post(`/agent/runs/${id}/cancel`); },
  async listApprovals(params = {}) { if (MOCK) { await wait(); const items = copy(mockApprovals).filter(x => !params.status || x.status === params.status); return { items, total: items.length }; } return client.get('/agent/approvals', { params }); },
  async decideApproval(id, decision, comment = '') { if (MOCK) { await wait(); const item = mockApprovals.find(x => x.id === id); if (item) item.status = decision === 'approve' ? 'approved' : 'rejected'; return { id, status: item?.status || 'approved' }; } return client.post(`/agent/approvals/${id}/${decision}`, { comment }); },
  async listKnowledge() { if (MOCK) { await wait(); return { items: copy(mockKnowledge), total: mockKnowledge.length }; } return client.get('/agent/knowledge'); },
  async searchKnowledge(query) { if (MOCK) { await wait(); return { query, items: mockKnowledge.filter(x => `${x.title} ${x.description}`.includes(query)).map(x => ({ ...x, score: 0.89 })) }; } return client.post('/agent/knowledge/search', { query }); }
};
