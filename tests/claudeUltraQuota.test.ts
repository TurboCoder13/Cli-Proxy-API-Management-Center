import { describe, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { apiCallApi } from '@/services/api';
import {
  CLAUDE_CONFIG,
  buildClaudeQuotaWindows,
  resolveClaudePlanType,
} from '@/features/quota/providers/claude/data';
import { ClaudeQuotaBody } from '@/features/quota/providers/claude/ClaudeQuotaBody';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import type { ClaudeProfileResponse, ClaudeUsagePayload } from '@/types';

// Sanitized fields from the migrated subscription. No account identifiers or tokens.
const reset = '2026-11-01T23:00:00Z';
const profile: ClaudeProfileResponse = {
  account: { has_claude_max: true, has_claude_pro: false },
  organization: {
    organization_type: 'claude_max',
    subscription_status: 'active',
    rate_limit_tier: 'default_claude_max_20x',
    plan_display_name: 'Ultra',
  },
};
const usage: ClaudeUsagePayload = {
  five_hour: null,
  seven_day: { utilization: 65, resets_at: reset },
  limits: [
    { kind: 'weekly_all', percent: 65, resets_at: reset, is_active: false },
    {
      kind: 'weekly_scoped',
      percent: 100,
      resets_at: reset,
      is_active: true,
      scope: { model: { id: null, display_name: 'Fable' } },
    },
  ],
  weekly_scoped_shares: [
    { limit_index: 1, used_percent_of_weekly: 50, allowance_percent_of_weekly: 50 },
  ],
  extra_usage: { is_enabled: false, monthly_limit: 0, used_credits: 0, utilization: null },
};
const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'test'
);
const t = i18n.getFixedT('en');

async function fetchQuota(payload: ClaudeUsagePayload, accountProfile = profile) {
  const request = spyOn(apiCallApi, 'request').mockImplementation(async ({ url }) => ({
    statusCode: 200,
    header: {},
    bodyText: '',
    body: url.endsWith('/profile') ? accountProfile : payload,
  }));
  try {
    return CLAUDE_CONFIG.buildSuccessState(
      await CLAUDE_CONFIG.fetchQuota({ name: 'test.json', authIndex: 'test-index' }, t)
    );
  } finally {
    request.mockRestore();
  }
}

describe('Claude Ultra migration', () => {
  test('uses the reported Ultra name despite legacy Max 20x metadata', async () => {
    expect(resolveClaudePlanType(profile)).toBe('plan_ultra');
    const quota = await fetchQuota(usage);
    expect(quota.planDisplayName).toBe('Ultra');
    expect(quota.fiveHourLimitAbsent).toBe(true);
    expect(quota.windows.map(({ id, usedPercent }) => ({ id, usedPercent }))).toEqual([
      { id: 'seven-day', usedPercent: 65 },
      { id: 'seven-day-fable', usedPercent: 100 },
    ]);
    await i18n.changeLanguage('en');
    const markup = renderToStaticMarkup(createElement(ClaudeQuotaBody, { quota, classes }));
    expect(markup).toContain('>Ultra<');
    expect(markup).not.toContain('>Max<');
    expect(markup).toContain('35% remaining');
    expect(markup).toContain('0% remaining');
    expect(markup).toContain('Limit reached: 7-day Fable.');
    expect(markup).toContain('cap 50%');
    expect(markup).toContain('Usage credits are disabled.');
    expect(markup).toContain('No five-hour limit reported');
    expect(markup).toContain('API credits do not extend these limits');
  });

  test('preserves future API display names without inventing a plan or quota entitlement', async () => {
    const quota = await fetchQuota({}, { organization: { plan_display_name: 'New plan' } });
    expect(quota.planDisplayName).toBe('New plan');
    expect(quota.planType).toBeNull();
    expect(quota.fiveHourLimitAbsent).toBe(false);
  });

  test('does not claim no session limit when the field is absent or a session limit exists', async () => {
    expect((await fetchQuota({})).fiveHourLimitAbsent).toBe(false);
    const quota = await fetchQuota({ five_hour: { utilization: 12, resets_at: reset } });
    expect(quota.fiveHourLimitAbsent).toBe(false);
    expect(quota.windows[0].id).toBe('five-hour');
  });

  test('uses modern overall quota even if the legacy field is missing or stale', () => {
    for (const seven_day of [undefined, { utilization: 10, resets_at: reset }]) {
      expect(buildClaudeQuotaWindows({ ...usage, seven_day }, t)[0].usedPercent).toBe(65);
    }
  });

  test('joins shares by original limit index without treating Fable 100% as total 100%', () => {
    const windows = buildClaudeQuotaWindows(usage, t);
    expect(windows[0].weeklyShare).toBeUndefined();
    expect(windows[1].weeklyShare).toEqual({ usedPercent: 50, allowancePercent: 50 });
  });

  test.each([
    [{ limit_index: 0, used_percent_of_weekly: 50, allowance_percent_of_weekly: 50 }],
    [{ limit_index: 1, used_percent_of_weekly: 50, allowance_percent_of_weekly: null }],
    [{ limit_index: 1, used_percent_of_weekly: -1, allowance_percent_of_weekly: 50 }],
  ])('does not invent a weekly share for malformed or unrelated data %j', (share) => {
    expect(
      buildClaudeQuotaWindows({ ...usage, weekly_scoped_shares: [share] }, t)[1].weeklyShare
    ).toBeUndefined();
  });

  test('retains Team organization precedence over personal Ultra flags', () => {
    expect(
      resolveClaudePlanType({
        ...profile,
        organization: { ...profile.organization, organization_type: 'claude_team' },
      })
    ).toBe('plan_team');
  });
});
