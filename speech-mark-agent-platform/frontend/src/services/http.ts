import axios, { type AxiosRequestConfig } from 'axios';

import type { ApiEnvelope } from '@/types';

import { clearAuth, getToken } from './token';

export class ApiError extends Error {
    code?: string;
    status?: number;
    retryable: boolean;

    constructor(
        message: string,
        options: { code?: string; status?: number; retryable?: boolean } = {}
    ) {
        super(message);
        this.name = 'ApiError';
        this.code = options.code;
        this.status = options.status;
        this.retryable = options.retryable ?? false;
    }
}

const http = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
    timeout: 30_000,
});

http.interceptors.request.use(config => {
    const token = getToken();
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

http.interceptors.response.use(
    response => response,
    error => {
        const status = error.response?.status as number | undefined;
        if (status === 401) {
            clearAuth();
            if (!window.location.pathname.startsWith('/login')) {
                window.location.replace('/login');
            }
        }
        const body = error.response?.data as ApiEnvelope<unknown> | undefined;
        throw new ApiError(body?.error?.message ?? error.message ?? '网络异常', {
            code: body?.error?.code,
            status,
            retryable: body?.error?.retryable ?? (status === 429 || status === 503),
        });
    }
);

async function request<T>(config: AxiosRequestConfig): Promise<T> {
    const response = await http.request<ApiEnvelope<T> | T>(config);
    const body = response.data;

    if (body && typeof body === 'object' && 'ok' in body) {
        const envelope = body as ApiEnvelope<T>;
        if (!envelope.ok) {
            throw new ApiError(envelope.error?.message ?? '请求失败', {
                code: envelope.error?.code,
                status: response.status,
                retryable: envelope.error?.retryable,
            });
        }
        return envelope.data;
    }

    return body as T;
}

export const api = {
    get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
        return request<T>({ ...config, method: 'GET', url });
    },
    post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
        return request<T>({ ...config, method: 'POST', url, data });
    },
    put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
        return request<T>({ ...config, method: 'PUT', url, data });
    },
    delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
        return request<T>({ ...config, method: 'DELETE', url });
    },
};

export default http;
