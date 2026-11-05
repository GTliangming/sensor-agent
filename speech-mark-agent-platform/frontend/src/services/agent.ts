import type { AgentRun, AgentThread, AgentTrace,ChatMessage } from '@/types';

import { api } from './http';
import { mockCreateRun, mockCreateThread, mockListThreads } from './mock';

const useMock = import.meta.env.VITE_USE_MOCK === 'true';

export function listThreads(): Promise<AgentThread[]> {
    if (useMock) {
        return mockListThreads();
    }
    return api.get<AgentThread[]>('/agent/threads');
}

export function createThread(title = '新会话'): Promise<AgentThread> {
    if (useMock) {
        return mockCreateThread(title);
    }
    return api.post<AgentThread>('/agent/threads', { title });
}

export function createRun(threadId: string, message: string): Promise<AgentRun> {
    if (useMock) {
        return mockCreateRun(threadId, message);
    }
    return api.post<AgentRun>(`/agent/threads/${threadId}/runs`, {
        message,
        mode: 'read_only',
    });
}

export function getRun(runId: string): Promise<AgentRun> {
    return api.get<AgentRun>(`/agent/runs/${runId}`);
}

export function getTrace(runId: string): Promise<AgentTrace> {
    return api.get<AgentTrace>(`/agent/runs/${runId}/trace`);
}
export function listMessages(threadId: string): Promise<ChatMessage[]> {
    if (useMock) {
        return Promise.resolve([]);
    }
    return api.get<ChatMessage[]>(`/agent/threads/${threadId}/messages`);
}