export type UserRole = 'admin' | 'project_admin' | 'group_admin' | 'reviewer' | 'annotator';

export interface AuthUser {
    id: string;
    username: string;
    displayName: string;
    role: UserRole;
    bound: boolean;
    goUserId?: string;
}

export interface LoginPayload {
    username: string;
    password: string;
}

export interface LoginResult {
    token: string;
    user: AuthUser;
}

export interface AgentThread {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
}

export interface Citation {
    documentId: string;
    title?: string;
    version?: string;
    section?: string;
    page?: number;
    quote?: string;
}

export type TraceStatus = 'pending' | 'running' | 'success' | 'error';

export interface TraceNode {
    id: string;
    name: string;
    status: TraceStatus;
    startedAt?: string;
    finishedAt?: string;
}

export interface ToolCallTrace {
    id: string;
    name: string;
    status: TraceStatus;
    argsSummary?: string;
    latencyMs?: number;
    error?: string;
}

export interface AgentTrace {
    runId: string;
    nodes: TraceNode[];
    toolCalls: ToolCallTrace[];
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt: string;
    citations?: Citation[];
    trace?: AgentTrace;
}

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface AgentRun {
    id: string;
    threadId: string;
    status: RunStatus;
    question: string;
    answer?: string;
    trace?: AgentTrace;
    createdAt: string;
}

export interface ReportSummary {
    id: string;
    title: string;
    type: string;
    period: string;
    createdAt: string;
}

export interface ApiMeta {
    requestId?: string;
    fetchedAt?: string;
    partial?: boolean;
    nextCursor?: string | null;
}

export interface ApiEnvelope<T> {
    ok: boolean;
    data: T;
    meta?: ApiMeta;
    warnings?: string[];
    error?: {
        code?: string;
        message?: string;
        retryable?: boolean;
    };
}
