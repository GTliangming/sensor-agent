import type { AuthUser } from '@/types';

const AUTH_KEY = 'annotation-ops-agent.auth';

interface StoredAuth {
    token: string | null;
    user: AuthUser | null;
}

const EMPTY_AUTH: StoredAuth = { token: null, user: null };

export function readAuth(): StoredAuth {
    try {
        const raw = localStorage.getItem(AUTH_KEY);
        if (!raw) {
            return EMPTY_AUTH;
        }
        const parsed = JSON.parse(raw) as Partial<StoredAuth>;
        return {
            token: typeof parsed.token === 'string' ? parsed.token : null,
            user: parsed.user ?? null,
        };
    } catch {
        return EMPTY_AUTH;
    }
}

export function getToken(): string | null {
    return readAuth().token;
}

export function writeAuth(token: string, user: AuthUser): void {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ token, user }));
}

export function clearAuth(): void {
    localStorage.removeItem(AUTH_KEY);
}
