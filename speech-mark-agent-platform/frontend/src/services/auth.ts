import type { AuthUser, LoginPayload, LoginResult } from '@/types';

import { api } from './http';
import { mockLogin } from './mock';

const useMock = import.meta.env.VITE_USE_MOCK === 'true';

export function login(payload: LoginPayload): Promise<LoginResult> {
    if (useMock) {
        return mockLogin(payload);
    }
    return api.post<LoginResult>('/auth/login', payload);
}

export function fetchMe(): Promise<AuthUser> {
    if (useMock) {
        return mockLogin({ username: 'demo', password: 'demo' }).then(result => result.user);
    }
    return api.get<AuthUser>('/auth/me');
}

export async function logout(): Promise<void> {
    if (useMock) {
        return;
    }
    await api.post('/auth/logout');
}
