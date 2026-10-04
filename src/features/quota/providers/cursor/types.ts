export interface CursorUsageMetric {
  key: string;
  value: number;
}

export interface CursorQuotaWindow {
  id: 'cursor_models' | 'other_models' | 'grok_bot';
  usedPercent: number;
  resetAtMs: number | null;
  periodHours: number | null;
}

export interface CursorQuotaData {
  plan: string | null;
  monthlyPrice: number | null;
  resetAtMs: number | null;
  onDemandEnabled: boolean | null;
  onDemandLimit: number | null;
  includedUsed: number | null;
  includedRemaining: number | null;
  includedLimit: number | null;
  windows: CursorQuotaWindow[];
  summary: CursorUsageMetric[];
}

export interface CursorQuotaState extends CursorQuotaData {
  status: 'idle' | 'loading' | 'success' | 'error';
  error?: string;
  errorStatus?: number;
}

export const emptyCursorQuota = (): CursorQuotaData => ({
  plan: null,
  monthlyPrice: null,
  resetAtMs: null,
  onDemandEnabled: null,
  onDemandLimit: null,
  includedUsed: null,
  includedRemaining: null,
  includedLimit: null,
  windows: [],
  summary: [],
});
