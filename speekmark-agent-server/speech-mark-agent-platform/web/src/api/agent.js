import client from './client';
import { mockRuns, mockTrace, mockStats, mockApprovals, mockKnowledge } from '../mocks/data';

// 是否使用本地 Mock 假数据:
// 读环境变量 VITE_USE_MOCK,未配置时默认为 'true'(即默认走假数据,不依赖后端)。
// 设为 'false' 后,下面所有请求都会真正发给 Go 后端。
const MOCK = String(import.meta.env.VITE_USE_MOCK ?? 'true') === 'true';

// 模拟网络延迟:让 Mock 模式下的交互更接近真实请求的等待体验。
const wait = (ms = 220) => new Promise((resolve) => setTimeout(resolve, ms));

// 深拷贝:返回数据的副本,避免调用方修改时污染 Mock 源数据。
const copy = (value) => JSON.parse(JSON.stringify(value));

// 智能体相关接口封装:每个方法在 Mock 模式下返回本地假数据,
// 否则通过 client 把请求真正发给 Go 后端(/agent/* 对应后端 /api/v1/agent/*)。
export const agentApi = {
  // 工作台统计数据
  async dashboard() {
    if (MOCK) {
      await wait();
      return copy(mockStats);
    }
    const r = await client.get('/agent/dashboard');
    // 把后端字段映射成前端图表需要的结构
    return {
      totalRuns: r.total_runs ?? 0,
      successRate: Number((r.success_rate ?? 0).toFixed(1)),
      avgDuration: r.avg_duration ?? 0,
      toolCalls: r.tool_calls ?? 0,
      daily: r.daily ?? [],
      statuses: r.statuses ?? [
        { type: '成功', value: r.success_runs ?? 0 },
        { type: '失败', value: r.failed_runs ?? 0 },
        { type: '运行中', value: r.running_runs ?? 0 },
        { type: '待审批', value: 0 },
      ],
    };
  },

  // 分页查询运行记录(支持按状态、关键词过滤)
  async listRuns(params = {}) {
    if (MOCK) {
      await wait();
      let items = copy(mockRuns);
      if (params.status) items = items.filter((x) => x.status === params.status);
      if (params.keyword)
        items = items.filter((x) =>
          `${x.run_id} ${x.input}`.toLowerCase().includes(params.keyword.toLowerCase())
        );
      return {
        items,
        total: items.length,
        page: params.page || 1,
        page_size: params.page_size || 10,
      };
    }
    return client.get('/agent/runs', { params });
  },

  // 创建一次智能体运行任务
  async createRun(payload) {
    if (MOCK) {
      await wait(350);
      const run = {
        run_id: `run_${Date.now()}`,
        input: payload.input,
        status: 'running',
        started_at: new Date().toISOString(),
        duration_ms: 0,
        steps: 1,
        tools: 0,
        tokens: 0,
      };
      mockRuns.unshift(run);
      return { run_id: run.run_id, status: run.status };
    }
    return client.post('/agent/runs', payload);
  },

  // 查询单个运行任务的详情
  async getRun(id) {
    if (MOCK) {
      await wait(160);
      const run = mockRuns.find((x) => x.run_id === id) || mockRuns[0];
      // Mock 模式下模拟任务执行:运行超过 6.5 秒就标记为成功并补全结果字段
      if (run.status === 'running' && Date.now() - new Date(run.started_at).getTime() > 6500) {
        run.status = 'succeeded';
        run.finished_at = new Date().toISOString();
        run.duration_ms = Date.now() - new Date(run.started_at).getTime();
        run.steps = 7;
        run.tools = 3;
        run.tokens = 2130;
        run.final_answer =
          '已完成模拟执行。正式接入后，这里将展示 Python Agent 基于 Go 业务 API 返回的真实数据生成的结论。';
      }
      return copy(run);
    }
    return client.get(`/agent/runs/${id}`);
  },

  // 查询运行任务的执行轨迹(Trace)
  async getTrace(id) {
    if (MOCK) {
      await wait(180);
      return { run_id: id, events: copy(mockTrace) };
    }
    return client.get(`/agent/runs/${id}/trace`);
  },

  // 请求取消某次运行
  async cancelRun(id) {
    if (MOCK) {
      await wait();
      const run = mockRuns.find((x) => x.run_id === id);
      if (run) run.status = 'cancelled';
      return { run_id: id, status: 'cancelled' };
    }
    return client.post(`/agent/runs/${id}/cancel`);
  },

  // 查询审批列表(可按状态过滤)
  async listApprovals(params = {}) {
    if (MOCK) {
      await wait();
      const items = copy(mockApprovals).filter((x) => !params.status || x.status === params.status);
      return { items, total: items.length };
    }
    return client.get('/agent/approvals', { params });
  },

  // 对某条审批做出决定(approve 批准 / reject 拒绝)
  async decideApproval(id, decision, comment = '') {
    if (MOCK) {
      await wait();
      const item = mockApprovals.find((x) => x.id === id);
      if (item) item.status = decision === 'approve' ? 'approved' : 'rejected';
      return { id, status: item?.status || 'approved' };
    }
    return client.post(`/agent/approvals/${id}/${decision}`, { comment });
  },

  // 查询知识库文档列表
  async listKnowledge() {
    if (MOCK) {
      await wait();
      return { items: copy(mockKnowledge), total: mockKnowledge.length };
    }
    return client.get('/agent/knowledge');
  },

  // 知识库检索
  async searchKnowledge(query) {
    if (MOCK) {
      await wait();
      return {
        query,
        items: mockKnowledge
          .filter((x) => `${x.title} ${x.description}`.includes(query))
          .map((x) => ({ ...x, score: 0.89 })),
      };
    }
    return client.post('/agent/knowledge/search', { query });
  },
};
