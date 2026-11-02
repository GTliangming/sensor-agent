import type { ReportSummary } from '@/types';

import { api } from './http';
import { mockListReports } from './mock';

const useMock = import.meta.env.VITE_USE_MOCK === 'true';

export function listReports(): Promise<ReportSummary[]> {
    if (useMock) {
        return mockListReports();
    }
    return api.get<ReportSummary[]>('/agent/reports');
}

export function getReport(reportId: string): Promise<ReportSummary> {
    return api.get<ReportSummary>(`/agent/reports/${reportId}`);
}
