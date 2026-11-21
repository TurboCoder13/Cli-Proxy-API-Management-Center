import { afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { apiClient } from '@/services/api/client';
import { cursorQuotaApi, parseCursorUsage, parseCursorQuota } from '@/services/api/cursorQuota';
import { emptyCursorQuota } from '@/features/quota/providers/cursor/types';
import { CURSOR_CONFIG } from '@/features/quota/providers/cursor/data';
import { CursorQuotaBody } from '@/features/quota/providers/cursor/CursorQuotaBody';
import { QuotaTimeline } from '@/features/quota/components/QuotaTimeline';
import {
  buildTimelineLane,
  projectLane,
  timelineSpan,
  DAY_MS,
  HOUR_MS,
} from '@/features/quota/quotaTimelineModel';
import { classifyQuotaFiles } from '@/features/quota/logic';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import { useQuotaStore } from '@/stores/useQuotaStore';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  useQuotaStore.getState().clearQuotaCache();
});

describe('local Cursor quota integration', () => {
  test('lists persisted Cursor accounts without including disabled or runtime-only entries', () => {
    expect(
      classifyQuotaFiles([
        { name: 'cursor.json', provider: 'cursor-local' },
        { name: 'off.json', provider: 'cursor-local', disabled: true },
        { name: 'runtime.json', provider: 'cursor-local', runtimeOnly: true },
      ]).map((e) => e.type)
    ).toEqual(['cursor-local']);
    expect(CURSOR_CONFIG.resetQuota).toBeUndefined();
  });

  test('uses the native v8 plugin endpoint and does not expose arbitrary response fields', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue({
      summary: [{ key: 'local_executions', value: 7, label: '<script>bad</script>' }],
      access_token: 'fixture-secret',
    });
    try {
      const result = await cursorQuotaApi.fetch('test-index');
      expect(post).toHaveBeenCalledWith('/plugins/cursor-local/quota', {
        auth_index: 'test-index',
        plugin_id: 'cursor-local',
        provider: 'cursor-local',
      });
      expect(result.summary).toEqual([{ key: 'local_executions', value: 7 }]);
      expect(JSON.stringify(result)).not.toContain('fixture-secret');
    } finally {
      post.mockRestore();
    }
  });

  test('rejects malformed summaries and filters invalid, repeated, and unknown metrics', () => {
    expect(() => parseCursorUsage({})).toThrow();
    expect(
      parseCursorUsage({
        summary: [
          { key: 'local_executions', value: 0 },
          { key: 'local_executions', value: 99 },
          { key: 'local_failed', value: -1 },
          { key: 'local_success', value: Number.NaN },
          { key: 'subscription_remaining', value: 100 },
        ],
      })
    ).toEqual([{ key: 'local_executions', value: 0 }]);
  });

  test('renders local counters with explicit unavailable quota and no percentage meter', () => {
    const classes = bindQuotaClasses(
      Object.fromEntries(QUOTA_CLASS_KEYS.map((k) => [k, k])),
      'test'
    );
    const html = renderToStaticMarkup(
      createElement(CursorQuotaBody, {
        quota: {
          ...emptyCursorQuota(),
          status: 'success',
          summary: [{ key: 'local_executions', value: 7 }],
        },
        classes,
      })
    );
    expect(html).toContain('Subscription usage could not be retrieved from Cursor.');
    expect(html).toContain('since proxy restart');
    expect(html).toContain('Local executions');
    expect(html).not.toContain('quotaBar');
  });

  test('clears local usage for credential deletion and connection changes', () => {
    const state = {
      ...emptyCursorQuota(),
      status: 'success' as const,
      summary: [{ key: 'local_executions', value: 7 }],
    };
    useQuotaStore.getState().setCursorQuota({ 'cursor.json': state, 'other.json': state });
    useQuotaStore.getState().clearQuotaCache(['cursor.json']);
    expect(useQuotaStore.getState().cursorQuota).toEqual({ 'other.json': state });
    useQuotaStore.getState().clearQuotaCache();
    expect(useQuotaStore.getState().cursorQuota).toEqual({});
  });
});

describe('provider-reported Cursor subscription quota', () => {
  const payload = {
    subscription: { plan: 'Pro' },
    summary: [
      { key: 'plan_monthly_price', value: 20 },
      { key: 'on_demand_enabled', value: 0 },
      { key: 'billing_cycle_end_ms', value: 1793689075000 },
      { key: 'billing_cycle_start_ms', value: 1791010675000 },
      { key: 'included_remaining', value: 18.67 },
    ],
    groups: [
      {
        buckets: [
          {
            window: 'cursor_models',
            remainingFraction: 0.9987777777777778,
            resetTime: '2026-11-03T06:57:55Z',
          },
          {
            window: 'other_models',
            remainingFraction: 0.9306666666666666,
            resetTime: '2026-11-03T06:57:55Z',
          },
          { window: 'grok_bot', remainingFraction: 1 },
        ],
      },
    ],
  };
  const laneFor = (raw: unknown) =>
    buildTimelineLane({
      name: 'cursor.json',
      displayName: 'Cursor account',
      provider: 'cursor-local',
      quota: { ...parseCursorQuota(raw), status: 'success' },
      maxPeriodHours: 14 * 24,
    });

  test('connects Cursor billing bounds and distinct remaining allowances to the timeline', () => {
    const lane = laneFor(payload);
    expect(lane.anchorMs).toBe(1793689075000);
    expect(lane.periodHours).toBe(31 * 24);
    expect(lane.reportedWindow).toEqual({ startMs: 1791010675000, endMs: 1793689075000 });
    expect(lane.remaining).toBe(93);
    expect(lane.windowLabelKey).toBe('cursor_quota.other_models');
    expect(lane.limits).toEqual([
      { label: 'cursor_quota.cursor_models', remaining: 99 },
      { label: 'cursor_quota.other_models', remaining: 93 },
      { label: 'cursor_quota.grok_bot', remaining: 100 },
    ]);
  });

  test('draws only the reported monthly cycle, with no invented prior or future cycles', () => {
    const lane = laneFor(payload);
    const now = new Date('2026-10-03T12:00:00Z').getTime();
    const span = timelineSpan('weekly', 0, now);
    const current = projectLane(lane, span.startMs, span.endMs, now, 'weekly');
    expect(current).toHaveLength(1);
    expect(current[0].startMs).toBe(1791010675000);
    expect(current[0].endMs).toBe(1793689075000);
    expect(current[0].remaining).toBe(93);
    expect(current[0].state).toBe('live');
    expect(current[0].leftPercent).toBeGreaterThan(0);
    expect(current[0].leftPercent + current[0].widthPercent).toBeCloseTo(100);

    const end = lane.anchorMs!;
    expect(projectLane(lane, end, end + 60 * DAY_MS, now, 'weekly')).toEqual([]);
    const stale = projectLane(lane, end - DAY_MS, end + DAY_MS, end + HOUR_MS, 'weekly');
    expect(stale).toHaveLength(1);
    expect(stale[0].state).toBe('past');
    expect(stale[0].remaining).toBeNull();
    expect(projectLane(lane, span.startMs, span.endMs, now, 'session')).toEqual([]);
  });

  test.each([
    ['2026-02-03T06:57:55Z', '2026-03-03T06:57:55Z', 28],
    ['2026-04-03T06:57:55Z', '2026-05-03T06:57:55Z', 30],
    ['2026-10-03T06:57:55Z', '2026-11-03T06:57:55Z', 31],
  ])('keeps exact reported dates for %s to %s (%d days)', (start, end, days) => {
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    const lane = laneFor({
      summary: [
        { key: 'billing_cycle_start_ms', value: startMs },
        { key: 'billing_cycle_end_ms', value: endMs },
      ],
      groups: [{ buckets: [{ window: 'other_models', remainingFraction: 1, resetTime: end }] }],
    });
    expect(lane.periodHours).toBe(days * 24);
    const windows = projectLane(lane, startMs - DAY_MS, endMs + 90 * DAY_MS, startMs, 'weekly');
    expect(windows).toHaveLength(1);
    expect(windows[0].startMs).toBe(startMs);
    expect(windows[0].endMs).toBe(endMs);
    expect(windows[0].remaining).toBe(100);
  });

  test('missing billing bounds and Grok-only data do not create invented windows', () => {
    expect(laneFor({ ...payload, summary: [] }).anchorMs).toBeNull();
    expect(
      laneFor({
        summary: [],
        groups: [{ buckets: [{ window: 'grok_bot', remainingFraction: 1 }] }],
      }).anchorMs
    ).toBeNull();
    const fallback = laneFor({ ...payload, groups: [{ buckets: [payload.groups[0].buckets[0]] }] });
    expect(fallback.windowLabelKey).toBe('cursor_quota.cursor_models');
    expect(fallback.remaining).toBe(99);
  });

  test('renders Cursor in the weekly timeline and keeps it out of the 5-hour view', () => {
    const props = {
      entries: [
        { file: { name: 'cursor.json', provider: 'cursor-local' }, type: 'cursor-local' as const },
      ],
      quotaFor: () => ({ ...parseCursorQuota(payload), status: 'success' as const }),
      displayNameFor: (name: string) => name,
      resolvedTheme: 'dark' as const,
      now: Date.parse('2026-10-03T12:00:00Z'),
    };
    const html = renderToStaticMarkup(createElement(QuotaTimeline, props));
    expect(html).toContain('cursor.json');
    expect(html).toContain('31d');
    expect(html).toContain('Cursor Models');
    expect(html).toContain('Other Models');
    expect(html).toContain('Grok Bot');
    expect(html).toContain('Other Models · 93%');
    expect(html).toContain('11/03');
    expect(html).toContain('reported billing window');
    const session = renderToStaticMarkup(
      createElement(QuotaTimeline, { ...props, initialMode: 'session' })
    );
    expect(session).toContain('role="status"');
    expect(session).not.toContain('cursor.json');
  });

  test('renders the native plan, separate usage buckets, real zero and disabled spending', () => {
    const data = parseCursorQuota(payload);
    expect(data.onDemandEnabled).toBe(false);
    expect(data.windows).toHaveLength(3);
    expect(data.windows[2].usedPercent).toBe(0);
    expect(data.windows[2].resetAtMs).toBeNull();
    const classes = bindQuotaClasses(
      Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
      'test'
    );
    const html = renderToStaticMarkup(
      createElement(CursorQuotaBody, { quota: { ...data, status: 'success' }, classes })
    );
    for (const label of [
      'Pro',
      '$20.00/mo',
      'Cursor Models',
      'Other Models',
      'Grok Bot',
      '1% used',
      '7% used',
      '0% used',
      'Disabled',
      '$18.67',
    ])
      expect(html).toContain(label);
    expect(html).not.toContain('could not be retrieved');
  });
  test('does not fabricate zero buckets, reset dates or enabled spending from missing fields', () => {
    const data = parseCursorQuota({
      summary: [],
      groups: [
        { buckets: [{ window: 'other_models' }, { window: 'grok_bot', remainingFraction: NaN }] },
      ],
    });
    expect(data.windows).toEqual([]);
    expect(data.onDemandEnabled).toBeNull();
    expect(data.resetAtMs).toBeNull();
    expect(data.includedRemaining).toBeNull();
  });
  test('bounds groups, deduplicates windows, rejects impossible fractions and escapes plan names', () => {
    const data = parseCursorQuota({
      subscription: { plan: '<img src=x>' },
      summary: [],
      groups: [
        {
          buckets: [
            { window: 'other_models', remainingFraction: -1 },
            { window: 'grok_bot', remainingFraction: 1 },
            { window: 'grok_bot', remainingFraction: 0 },
            { window: 'unknown', remainingFraction: 1 },
          ],
        },
      ],
    });
    expect(data.windows).toHaveLength(1);
    const classes = bindQuotaClasses(
      Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
      'test'
    );
    const html = renderToStaticMarkup(
      createElement(CursorQuotaBody, { quota: { ...data, status: 'success' }, classes })
    );
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img src=x&gt;');
  });
});
