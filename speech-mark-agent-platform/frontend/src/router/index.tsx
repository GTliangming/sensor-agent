import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';

import PageLoading from '@/components/PageLoading';
import AppLayout from '@/layouts/AppLayout';

import AuthGuard from './AuthGuard';

const LoginPage = lazy(() => import('@/pages/login'));
const ChatPage = lazy(() => import('@/pages/chat'));
const AnalyticsPage = lazy(() => import('@/pages/analytics'));
const ReportListPage = lazy(() => import('@/pages/reports'));
const ReportDetailPage = lazy(() => import('@/pages/reports/detail'));
const KnowledgePage = lazy(() => import('@/pages/knowledge'));
const HistoryPage = lazy(() => import('@/pages/history'));
const AdminPage = lazy(() => import('@/pages/admin'));
const MonitorPage = lazy(() => import('@/pages/monitor'));
const NotFoundPage = lazy(() => import('@/pages/not-found'));

function lazyPage(node: ReactNode) {
    return <Suspense fallback={<PageLoading />}>{node}</Suspense>;
}

export const router = createBrowserRouter([
    {
        path: '/login',
        element: lazyPage(<LoginPage />),
    },
    {
        path: '/',
        element: (
            <AuthGuard>
                <AppLayout />
            </AuthGuard>
        ),
        children: [
            { index: true, element: <Navigate to="/chat" replace /> },
            { path: 'chat', element: lazyPage(<ChatPage />) },
            { path: 'chat/:threadId', element: lazyPage(<ChatPage />) },
            { path: 'analytics', element: lazyPage(<AnalyticsPage />) },
            { path: 'reports', element: lazyPage(<ReportListPage />) },
            { path: 'reports/:reportId', element: lazyPage(<ReportDetailPage />) },
            { path: 'knowledge', element: lazyPage(<KnowledgePage />) },
            { path: 'history', element: lazyPage(<HistoryPage />) },
            { path: 'admin', element: lazyPage(<AdminPage />) },
            { path: 'monitor', element: lazyPage(<MonitorPage />) },
        ],
    },
    {
        path: '*',
        element: lazyPage(<NotFoundPage />),
    },
]);
