import { beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { ANTIGRAVITY_CONFIG } from '@/features/quota/providers/antigravity/data';
import { AntigravityQuotaBody } from '@/features/quota/providers/antigravity/AntigravityQuotaBody';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import { antigravitySubscriptionApi, apiCallApi } from '@/services/api';
import { buildAntigravityQuotaGroups } from '@/utils/quota';
import type { AntigravityQuotaSummaryPayload } from '@/types';

const resetTime = new Date(Date.now() + 70 * 60_000).toISOString();
const weeklyResetTime = new Date(Date.now() + 6 * 24 * 60 * 60_000).toISOString();

// Redacted shape returned by retrieveUserQuotaSummary for the current CLI.
// The same account queried as 1.0.13 returns only the third-party group.
const summary = {
  groups: [
    {
      displayName: 'Gemini Models',
      description: 'Models within this group: Gemini 4 Neon, Gemini 4 Hydrogen, Gemini 3.8 Flash',
      buckets: [
        {
          bucketId: 'gemini-weekly',
          displayName: 'Weekly Limit Remaining',
          window: 'weekly',
          remainingFraction: 0.4146885,
          resetTime: weeklyResetTime,
        },
        {
          bucketId: 'gemini-5h',
          displayName: 'Five Hour Limit Remaining',
          window: '5h',
          remainingFraction: 0,
          resetTime,
        },
      ],
    },
    {
      displayName: 'Claude and GPT models',
      buckets: [
        {
          bucketId: '3p-weekly',
          displayName: 'Weekly Limit Remaining',
          window: 'weekly',
          remainingFraction: 1,
        },
        {
          bucketId: '3p-5h',
          displayName: 'Five Hour Limit Remaining',
          window: '5h',
          remainingFraction: 1,
        },
      ],
    },
    {
      displayName: 'Gemini 4 Argon',
      buckets: [
        {
          bucketId: 'gemini-argon-wtu-weekly',
          displayName: 'Gemini 4 Argon Weekly Limit',
          window: 'weekly',
          remainingFraction: 0.99867666,
          resetTime: weeklyResetTime,
        },
      ],
    },
  ],
} satisfies AntigravityQuotaSummaryPayload;

const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'test-host'
);

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('Antigravity model-group quotas', () => {
  test('requests the complete quota summary with a current client version', async () => {
    const subscription = spyOn(antigravitySubscriptionApi, 'get').mockResolvedValue({
      plan: 'pro',
      tierId: 'g1-pro-tier',
      tierName: 'Google AI Pro',
    });
    const request = spyOn(apiCallApi, 'request').mockImplementation(async ({ header }) => {
      const version = header?.['User-Agent']?.match(/^antigravity\/hub\/(\d+)\.(\d+)\./);
      const hasGeminiQuota = Boolean(
        version && (Number(version[1]) > 1 || (version[1] === '1' && Number(version[2]) >= 5))
      );
      return {
        statusCode: 200,
        header: {},
        bodyText: '',
        body: hasGeminiQuota ? summary : { groups: [summary.groups[1]] },
      };
    });

    try {
      const result = await ANTIGRAVITY_CONFIG.fetchQuota(
        { name: 'test-antigravity.json', auth_index: 'test-index', project_id: 'test-project' },
        i18n.t
      );
      expect(result.groups.map((group) => group.label)).toEqual([
        'Gemini Models',
        'Claude and GPT models',
        'Gemini 4 Argon',
      ]);
      expect(result.subscription?.plan).toBe('pro');
      expect(result.groups[0].buckets.map((bucket) => bucket.remainingFraction)).toEqual([
        0, 0.4146885,
      ]);
      expect(result.groups[0].buckets[0].resetTime).toBe(resetTime);
    } finally {
      request.mockRestore();
      subscription.mockRestore();
    }
  });

  test('renders exhausted Gemini separately from available third-party quotas', () => {
    const markup = renderToStaticMarkup(
      createElement(AntigravityQuotaBody, {
        quota: {
          status: 'success',
          groups: buildAntigravityQuotaGroups(summary),
          subscription: { plan: 'pro', tierId: 'g1-pro-tier', tierName: 'Google AI Pro' },
        },
        classes,
      })
    );

    expect(markup).toContain('Gemini 4 Neon');
    expect(markup).toContain('Gemini 4 Argon');
    expect(markup).toContain('Claude and GPT models');
    expect(markup).toContain('0% remaining');
    expect(markup).toContain('41% remaining');
    expect(markup).toContain('100% remaining');
    expect(markup).toContain('Refreshes in');
    expect(markup).not.toContain('Quota available');
  });
});
