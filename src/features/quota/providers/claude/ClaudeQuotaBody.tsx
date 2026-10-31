/**
 * Claude 额度渲染体：套餐/额外用量 chip 行 + 用量窗口水位条。
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClaudeQuotaState } from '@/types';
import { buildResetDisplay } from '@/utils/quota';
import { useNow } from '@/hooks/useNow';
import { QuotaMeter } from '../../components/QuotaMeter';
import { QuotaResetLabel } from '../../components/QuotaResetLabel';
import { collectQuotaRowInstants, pickUrgentRowId } from '../../resetSchedule';
import type { QuotaBodyProps } from '../../types';

export function ClaudeQuotaBody({ quota, classes }: QuotaBodyProps<ClaudeQuotaState>) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const soonestRowId = useMemo(
    () => pickUrgentRowId(collectQuotaRowInstants('claude', quota), now),
    [quota, now]
  );
  const windows = quota.windows ?? [];
  const extraUsage = quota.extraUsage ?? null;
  const planType = quota.planType ?? null;
  const planName = quota.planDisplayName || (planType ? t(`claude_quota.${planType}`) : null);
  const exhausted = windows.filter(
    (window) => window.usedPercent !== null && window.usedPercent >= 100
  );

  return (
    <>
      {planName && (
        <div className={classes.codexPlan}>
          <span className={classes.codexPlanLabel}>{t('claude_quota.plan_label')}</span>
          <span className={classes.codexPlanValue}>{planName}</span>
        </div>
      )}
      {quota.fiveHourLimitAbsent && (
        <div className={classes.quotaMessage}>{t('claude_quota.no_five_hour_limit')}</div>
      )}
      {exhausted.length > 0 && (
        <div role="status" className={classes.codexResetCreditsError}>
          {t('claude_quota.exhausted', {
            limits: exhausted
              .map((window) => (window.labelKey ? t(window.labelKey) : window.label))
              .join(', '),
          })}
          {exhausted.some((window) => window.id === 'seven-day-fable') && (
            <> {t('claude_quota.fable_exhausted_hint')}</>
          )}
          {extraUsage?.is_enabled === false && <> {t('claude_quota.usage_credits_disabled')}</>}
        </div>
      )}
      {extraUsage && extraUsage.is_enabled && (
        <div className={classes.codexPlan}>
          <span className={classes.codexPlanLabel}>{t('claude_quota.extra_usage_label')}</span>
          <span className={classes.codexPlanValue}>
            {`$${(extraUsage.used_credits / 100).toFixed(2)} / $${(extraUsage.monthly_limit / 100).toFixed(2)}`}
          </span>
        </div>
      )}
      {windows.length === 0 ? (
        <div className={classes.quotaMessage}>{t('claude_quota.empty_windows')}</div>
      ) : (
        windows.map((window, index) => {
          const used = window.usedPercent;
          const clampedUsed = used === null ? null : Math.max(0, Math.min(100, used));
          const remaining =
            clampedUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedUsed));
          const percentLabel =
            remaining === null
              ? '--'
              : t('claude_quota.remaining_percent', {
                  percent: new Intl.NumberFormat(i18n.resolvedLanguage, {
                    maximumFractionDigits: 1,
                  }).format(remaining),
                });
          const windowLabel = window.labelKey ? t(window.labelKey) : window.label;
          const resetDisplay = buildResetDisplay(
            window.resetLabel,
            window.resetAtMs,
            now,
            i18n.resolvedLanguage
          );

          const soon = window.id === soonestRowId;

          return (
            <div
              key={window.id}
              className={classes.quotaRow}
              title={soon ? t('quota_management.soonest_row_hint') : undefined}
            >
              <div className={classes.quotaRowHeader}>
                <span className={classes.quotaModel}>{windowLabel}</span>
                <div className={classes.quotaMeta}>
                  <span className={classes.quotaPercent}>{percentLabel}</span>
                  {resetDisplay && (
                    <QuotaResetLabel display={resetDisplay} classes={classes} soon={soon} />
                  )}
                </div>
              </div>
              <QuotaMeter percent={remaining} classes={classes} index={index} />
              {window.weeklyShare && (
                <div className={classes.quotaAmount}>
                  {t('claude_quota.weekly_share', {
                    used: window.weeklyShare.usedPercent,
                    allowance: window.weeklyShare.allowancePercent,
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
      <div className={classes.quotaMessage}>{t('claude_quota.api_credits_separate')}</div>
    </>
  );
}
