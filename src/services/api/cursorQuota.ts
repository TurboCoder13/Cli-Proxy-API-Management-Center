import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';
import type {
  CursorQuotaData,
  CursorQuotaWindow,
  CursorUsageMetric,
} from '@/features/quota/providers/cursor/types';

const LOCAL_METRIC_KEYS = new Set([
  'local_executions',
  'local_success',
  'local_failed',
  'estimated_input_tokens',
  'estimated_output_tokens',
]);
const PROVIDER_METRIC_KEYS = new Set([
  'plan_monthly_price',
  'billing_cycle_start_ms',
  'billing_cycle_end_ms',
  'on_demand_enabled',
  'on_demand_limit',
  'included_used',
  'included_remaining',
  'included_limit',
]);

function parseMetrics(payload: unknown): CursorUsageMetric[] {
  if (!isRecord(payload) || !Array.isArray(payload.summary)) {
    throw new Error('Invalid Cursor quota response');
  }
  const seen = new Set<string>();
  return payload.summary.slice(0, 32).flatMap((entry): CursorUsageMetric[] => {
    if (
      !isRecord(entry) ||
      typeof entry.key !== 'string' ||
      (!LOCAL_METRIC_KEYS.has(entry.key) && !PROVIDER_METRIC_KEYS.has(entry.key)) ||
      typeof entry.value !== 'number' ||
      !Number.isFinite(entry.value) ||
      entry.value < 0 ||
      seen.has(entry.key)
    )
      return [];
    seen.add(entry.key);
    return [{ key: entry.key, value: entry.value }];
  });
}

export function parseCursorUsage(payload: unknown): CursorUsageMetric[] {
  return parseMetrics(payload).filter((metric) => LOCAL_METRIC_KEYS.has(metric.key));
}

const validTimestamp = (value: number | undefined): number | null =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 946684800000 &&
  value <= 4102444800000
    ? value
    : null;

export function parseCursorQuota(payload: unknown): CursorQuotaData {
  const metrics = parseMetrics(payload);
  const values = new Map(metrics.map((metric) => [metric.key, metric.value]));
  const summary = metrics.filter((metric) => LOCAL_METRIC_KEYS.has(metric.key));
  const resetAtMs = validTimestamp(values.get('billing_cycle_end_ms'));
  const startAtMs = validTimestamp(values.get('billing_cycle_start_ms'));
  const raw = isRecord(payload) ? payload : {};
  const subscription = isRecord(raw.subscription) ? raw.subscription : null;
  const plan =
    typeof subscription?.plan === 'string' &&
    subscription.plan.length <= 128 &&
    subscription.plan.trim()
      ? subscription.plan
      : null;
  const seen = new Set<string>();
  const windows: CursorQuotaWindow[] = [];
  if (Array.isArray(raw.groups)) {
    for (const group of raw.groups.slice(0, 16)) {
      if (!isRecord(group) || !Array.isArray(group.buckets)) continue;
      for (const bucket of group.buckets.slice(0, 16)) {
        if (!isRecord(bucket)) continue;
        const id = bucket.window;
        if (id !== 'cursor_models' && id !== 'other_models' && id !== 'grok_bot') continue;
        const fraction = bucket.remainingFraction;
        if (
          seen.has(id) ||
          typeof fraction !== 'number' ||
          !Number.isFinite(fraction) ||
          fraction < 0 ||
          fraction > 1
        )
          continue;
        seen.add(id);
        const reset =
          typeof bucket.resetTime === 'string'
            ? validTimestamp(Date.parse(bucket.resetTime))
            : null;
        windows.push({
          id,
          usedPercent: Math.min(100, Math.max(0, (1 - fraction) * 100)),
          resetAtMs: reset,
          periodHours:
            id !== 'grok_bot' && reset !== null && startAtMs !== null && reset > startAtMs
              ? (reset - startAtMs) / 3600000
              : null,
        });
      }
    }
  }
  const enabled = values.get('on_demand_enabled');
  return {
    plan,
    monthlyPrice: values.get('plan_monthly_price') ?? null,
    resetAtMs,
    onDemandEnabled: enabled === 0 ? false : enabled === 1 ? true : null,
    onDemandLimit: values.get('on_demand_limit') ?? null,
    includedUsed: values.get('included_used') ?? null,
    includedRemaining: values.get('included_remaining') ?? null,
    includedLimit: values.get('included_limit') ?? null,
    windows,
    summary,
  };
}

export const cursorQuotaApi = {
  fetch: async (authIndex: string): Promise<CursorQuotaData> =>
    parseCursorQuota(
      await apiClient.post<unknown>('/plugins/cursor-local/quota', {
        auth_index: authIndex,
        plugin_id: 'cursor-local',
        provider: 'cursor-local',
      })
    ),
};
