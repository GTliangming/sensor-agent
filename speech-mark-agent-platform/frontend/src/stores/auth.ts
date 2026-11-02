import { create } from 'zustand';

import type { AuthUser } from '@/types';

import { clearAuth, readAuth, writeAuth } from '@/services/token';

interface AuthState {
    token: string | null;
    user: AuthUser | null;
    setAuth: (token: string, user: AuthUser) => void;
    logout: () => void;
}

const initial = readAuth();

export const useAuthStore = create<AuthState>(set => ({
    token: initial.token,
    user: initial.user,
    setAuth: (token, user) => {
        writeAuth(token, user);
        set({ token, user });
    },
    logout: () => {
        clearAuth();
        set({ token: null, user: null });
    },
}));
