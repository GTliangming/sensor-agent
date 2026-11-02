import type { AgentRun, AgentThread, LoginPayload, LoginResult, ReportSummary } from '@/types';

const delay = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

const uid = (prefix: string) =>
    `${prefix}_${globalThis.crypto?.randomUUID?.() ?? String(Date.now())}`;

export async function mockLogin(payload: LoginPayload): Promise<LoginResult> {
    await delay(300);
    if (!payload.username.trim() || !payload.password.trim()) {
        throw new Error('请输入用户名和密码');
    }
    return {
        token: `mock-token-${Date.now()}`,
        user: {
            id: 'u_demo',
            username: payload.username.trim(),
            displayName: '演示用户',
            role: 'admin',
            bound: true,
            goUserId: '10001',
        },
    };
}

export async function mockListThreads(): Promise<AgentThread[]> {
    await delay(200);
    const now = new Date().toISOString();
    return [
        { id: 'thread_demo_1', title: '项目 A 昨日生产巡检', createdAt: now, updatedAt: now },
        { id: 'thread_demo_2', title: '工作组效率对比', createdAt: now, updatedAt: now },
    ];
}

export async function mockCreateThread(title: string): Promise<AgentThread> {
    await delay(150);
    const now = new Date().toISOString();
    return { id: uid('thread'), title, createdAt: now, updatedAt: now };
}

export async function mockCreateRun(threadId: string, question: string): Promise<AgentRun> {
    await delay(600);
    const now = new Date().toISOString();
    const runId = uid('run');
    return {
        id: runId,
        threadId,
        status: 'succeeded',
        question,
        answer: [
            '当前是开发模式下的占位回答。',
            '',
            `收到的问题：${question}`,
            '',
            '后端就绪后，这里会展示 FastAPI + LangGraph 返回的真实分析结果，并附带数据来源、统计口径和规范引用。',
        ].join('\n'),
        trace: {
            runId,
            nodes: [
                { id: 'n1', name: 'understand_intent', status: 'success', startedAt: now, finishedAt: now },
                { id: 'n2', name: 'plan', status: 'success', startedAt: now, finishedAt: now },
                { id: 'n3', name: 'summarize', status: 'success', startedAt: now, finishedAt: now },
            ],
            toolCalls: [
                {
                    id: 'tc1',
                    name: 'list_accessible_projects',
                    status: 'success',
                    argsSummary: 'page=1, page_size=20',
                    latencyMs: 128,
                },
                {
                    id: 'tc2',
                    name: 'get_project_overview',
                    status: 'success',
                    argsSummary: 'project_id=PROJECT-DEMO',
                    latencyMs: 96,
                },
            ],
        },
        createdAt: now,
    };
}

export async function mockListReports(): Promise<ReportSummary[]> {
    await delay(200);
    return [];
}
