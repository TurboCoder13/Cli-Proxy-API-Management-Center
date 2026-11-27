import { afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { apiClient } from '@/services/api/client';
import { authFilesApi } from '@/services/api/authFiles';
import {
  GEMINI_SNAPSHOT_CONFIG,
  countResetsSinceSnapshot,
  parseGeminiUsageSnapshot,
} from '@/features/quota/providers/geminiSnapshot/data';
import { GeminiSnapshotQuotaBody } from '@/features/quota/providers/geminiSnapshot/GeminiSnapshotQuotaBody';
import { classifyQuotaFiles, resolveQuotaProviderType } from '@/features/quota/logic';
import { collectQuotaRowInstants } from '@/features/quota/resetSchedule';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import { isPluginQuotaFile } from '@/utils/quota';
import { useQuotaStore } from '@/stores/useQuotaStore';

/** Shape of `command.data` as printed by `agy -p /usage --output-format json` (1.5.18). */
const USAGE = {
  description: 'Within each group, models share a weekly limit and a 5-hour limit.',
  groups: [
    {
      name: 'Gemini Models',
      description: 'Models within this group: Gemini 4 Neon, Gemini 3.8 Flash',
      buckets: [
        {
          id: 'gemini-weekly',
          name: 'Weekly Limit Remaining',
          description: 'You have used some of your weekly limit.',
          window: 'weekly',
          remaining_fraction: 0.9987748265266418,
          reset_time: '2026-12-04T11:15:42Z',
        },
        {
          id: 'gemini-5h',
          name: 'Five Hour Limit Remaining',
          window: '5h',
          remaining_fraction: 0.9950991272926331,
          reset_time: '2026-11-27T16:15:42Z',
        },
      ],
    },
    {
      name: 'Claude and GPT models',
      buckets: [
        {
          id: '3p-weekly',
          name: 'Weekly Limit Remaining',
          window: 'weekly',
          remaining_fraction: 1,
          reset_time: '1970-01-01T00:00:00Z',
        },
      ],
    },
  ],
};

const CAPTURED_AT = '2026-11-27T12:31:00Z';
const SNAPSHOT = JSON.stringify({
  type: 'gemini-usage-snapshot',
  captured_at: CAPTURED_AT,
  usage: USAGE,
});

const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'test'
);

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  useQuotaStore.getState().clearQuotaCache();
});

describe('saved Gemini usage parsing', () => {
  test('maps the CLI groups and windows onto quota rows', () => {
    const data = parseGeminiUsageSnapshot(SNAPSHOT);
    expect(data.capturedAtMs).toBe(Date.parse(CAPTURED_AT));
    expect(data.groups.map((group) => group.label)).toEqual([
      'Gemini Models',
      'Claude and GPT models',
    ]);
    const gemini = data.groups[0].buckets;
    expect(gemini.map((bucket) => bucket.label).sort()).toEqual([
      'Five Hour Limit Remaining',
      'Weekly Limit Remaining',
    ]);
    const weekly = gemini.find((bucket) => bucket.window === 'weekly');
    expect(weekly?.remainingFraction).toBeCloseTo(0.99877, 4);
    expect(weekly?.resetAtMs).toBe(Date.parse('2026-12-04T11:15:42Z'));
    expect(weekly?.periodHours).toBe(24 * 7);
    expect(gemini.find((bucket) => bucket.window === '5h')?.periodHours).toBe(5);
  });

  test('drops the epoch placeholder the CLI reports when no reset is pending', () => {
    const bucket = parseGeminiUsageSnapshot(SNAPSHOT).groups[1].buckets[0];
    expect(bucket.resetTime).toBeUndefined();
    expect(bucket.resetAtMs ?? null).toBeNull();
  });

  test('accepts a raw CLI capture and reports an unknown capture time', () => {
    const data = parseGeminiUsageSnapshot(
      JSON.stringify({ status: 'SUCCESS', command: { name: 'usage', data: USAGE } })
    );
    expect(data.groups).toHaveLength(2);
    expect(data.capturedAtMs).toBeNull();
  });

  test('skips rows without a numeric remaining fraction', () => {
    const data = parseGeminiUsageSnapshot(
      JSON.stringify({
        usage: {
          groups: [
            {
              name: 'Gemini Models',
              buckets: [{ id: 'a', name: 'Weekly', window: 'weekly', remaining_fraction: '0.5' }],
            },
          ],
        },
      })
    );
    expect(data.groups.flatMap((group) => group.buckets)).toHaveLength(0);
  });

  test.each(['', 'not json', '[]', '{}', '{"usage":{}}', '{"usage":{"groups":"x"}}'])(
    'rejects %p',
    (source) => {
      expect(() => parseGeminiUsageSnapshot(source)).toThrow('Invalid Gemini usage snapshot');
    }
  );
});

describe('saved Gemini usage card', () => {
  test('claims only enabled snapshot files and never the Gemini or Antigravity credentials', () => {
    expect(
      classifyQuotaFiles([
        { name: 'gemini-usage-snapshot.json', provider: 'gemini-usage-snapshot' },
        { name: 'off.json', provider: 'gemini-usage-snapshot', disabled: true },
        { name: 'runtime.json', provider: 'gemini-usage-snapshot', runtimeOnly: true },
        { name: 'gemini-a.json', provider: 'gemini' },
      ]).map((entry) => `${entry.file.name}:${entry.type}`)
    ).toEqual(['gemini-usage-snapshot.json:gemini-usage-snapshot']);
    expect(resolveQuotaProviderType({ name: 'a.json', provider: 'antigravity' })).toBe(
      'antigravity'
    );
    expect(
      isPluginQuotaFile({
        name: 'gemini-usage-snapshot.json',
        provider: 'gemini-usage-snapshot',
        supportsQuota: true,
      })
    ).toBe(false);
    expect(GEMINI_SNAPSHOT_CONFIG.resetQuota).toBeUndefined();
  });

  test('loads by downloading the saved file and makes no other request', async () => {
    const download = spyOn(authFilesApi, 'downloadText').mockResolvedValue(SNAPSHOT);
    const post = spyOn(apiClient, 'post');
    const get = spyOn(apiClient, 'get');
    try {
      const data = await GEMINI_SNAPSHOT_CONFIG.fetchQuota(
        { name: 'gemini-usage-snapshot.json', provider: 'gemini-usage-snapshot' },
        i18n.t
      );
      expect(download).toHaveBeenCalledTimes(1);
      expect(download).toHaveBeenCalledWith('gemini-usage-snapshot.json');
      expect(post).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
      expect(data.groups).toHaveLength(2);
    } finally {
      download.mockRestore();
      post.mockRestore();
      get.mockRestore();
    }
  });

  test('counts only resets that passed after the snapshot was taken', () => {
    const data = parseGeminiUsageSnapshot(SNAPSHOT);
    const fiveHourReset = Date.parse('2026-11-27T16:15:42Z');
    expect(countResetsSinceSnapshot(data, fiveHourReset - 1)).toBe(0);
    expect(countResetsSinceSnapshot(data, fiveHourReset)).toBe(1);
    expect(countResetsSinceSnapshot(data, Date.parse('2026-12-05T00:00:00Z'))).toBe(2);
    // A snapshot taken after a reset already reflects it.
    expect(
      countResetsSinceSnapshot({ ...data, capturedAtMs: fiveHourReset + 1 }, fiveHourReset + 2)
    ).toBe(0);
  });

  test('feeds recovery sorting with the real reset instants only', () => {
    const state = { ...parseGeminiUsageSnapshot(SNAPSHOT), status: 'success' as const };
    expect(
      collectQuotaRowInstants('gemini-usage-snapshot', state)
        .map((instant) => instant.atMs)
        .sort()
    ).toEqual([Date.parse('2026-11-27T16:15:42Z'), Date.parse('2026-12-04T11:15:42Z')]);
  });

  test('renders the capture time, the manual-refresh note and every limit', () => {
    const data = parseGeminiUsageSnapshot(SNAPSHOT);
    const html = renderToStaticMarkup(
      createElement(GeminiSnapshotQuotaBody, {
        // Captured in the future relative to no reset: keeps the stale note off.
        quota: { ...data, capturedAtMs: Date.parse('2999-01-01T00:00:00Z'), status: 'success' },
        classes,
      })
    );
    expect(html).toContain('data-quota-snapshot=""');
    expect(html).toContain('Saved');
    expect(html).toContain('Saved by hand from Google&#x27;s own CLI');
    expect(html).not.toContain('has reset since this was saved');
    for (const label of ['Gemini Models', 'Weekly Limit Remaining', 'Five Hour Limit Remaining']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('100% remaining');
  });

  test('warns when a limit has reset since the snapshot and when the time is unknown', () => {
    // Fixed past instants keep this independent of the wall clock.
    const data = parseGeminiUsageSnapshot(
      JSON.stringify({
        captured_at: '2020-01-01T00:00:00Z',
        usage: {
          groups: [
            {
              name: 'Gemini Models',
              buckets: [
                {
                  id: 'gemini-5h',
                  name: 'Five Hour Limit Remaining',
                  window: '5h',
                  remaining_fraction: 0.4,
                  reset_time: '2020-01-01T05:00:00Z',
                },
              ],
            },
          ],
        },
      })
    );
    const stale = renderToStaticMarkup(
      createElement(GeminiSnapshotQuotaBody, { quota: { ...data, status: 'success' }, classes })
    );
    expect(stale).toContain('A limit has reset since this was saved');
    const unknown = renderToStaticMarkup(
      createElement(GeminiSnapshotQuotaBody, {
        quota: { groups: [], capturedAtMs: null, status: 'success' },
        classes,
      })
    );
    expect(unknown).toContain('Unknown');
    expect(unknown).toContain('No quota data available');
  });
});
