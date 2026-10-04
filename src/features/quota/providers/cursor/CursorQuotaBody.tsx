import { useTranslation } from 'react-i18next';
import { QuotaMeter } from '../../components/QuotaMeter';
import type { QuotaBodyProps } from '../../types';
import type { CursorQuotaState } from './types';

export function CursorQuotaBody({ quota, classes }: QuotaBodyProps<CursorQuotaState>) {
  const { t, i18n } = useTranslation();
  const money = (value: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  const date = (value: number) => new Date(value).toLocaleString(i18n.language);
  return (
    <>
      <div className={classes.codexPlan}>
        <span className={classes.codexPlanLabel}>{t('cursor_quota.plan')}</span>
        <span className={classes.codexPlanValue}>{quota.plan ?? t('cursor_quota.unknown')}</span>
        {quota.monthlyPrice !== null && (
          <span>{t('cursor_quota.per_month', { price: money(quota.monthlyPrice) })}</span>
        )}
      </div>
      {quota.resetAtMs !== null && (
        <div className={classes.quotaMessage}>
          {t('cursor_quota.usage_resets', { date: date(quota.resetAtMs) })}
        </div>
      )}
      {quota.windows.length === 0 && (
        <div className={classes.quotaMessage}>{t('cursor_quota.unavailable')}</div>
      )}
      {quota.windows.map((window, index) => (
        <div className={classes.quotaRow} key={window.id}>
          <div className={classes.quotaRowHeader}>
            <span className={classes.quotaModel}>{t(`cursor_quota.${window.id}`)}</span>
            <span className={classes.quotaPercent}>
              {t('cursor_quota.percent_used', { percent: Math.ceil(window.usedPercent - 1e-9) })}
            </span>
          </div>
          <QuotaMeter percent={100 - window.usedPercent} classes={classes} index={index} />
          <div className={classes.quotaMessage}>
            {t('cursor_quota.percent_remaining', {
              percent: Math.floor(100 - window.usedPercent + 1e-9),
            })}
          </div>
          <div className={classes.quotaMessage}>{t(`cursor_quota.${window.id}_description`)}</div>
          {window.resetAtMs !== null && window.id === 'grok_bot' && (
            <div className={classes.quotaReset}>
              {t('cursor_quota.usage_resets', { date: date(window.resetAtMs) })}
            </div>
          )}
        </div>
      ))}
      {(quota.includedUsed !== null || quota.includedRemaining !== null) && (
        <div className={classes.quotaMessage}>
          {quota.includedUsed !== null && (
            <div>{t('cursor_quota.included_used', { amount: money(quota.includedUsed) })}</div>
          )}
          {quota.includedRemaining !== null && (
            <div>
              {t('cursor_quota.included_remaining', { amount: money(quota.includedRemaining) })}
            </div>
          )}
          {quota.includedLimit !== null && (
            <div>{t('cursor_quota.included_limit', { amount: money(quota.includedLimit) })}</div>
          )}
        </div>
      )}
      <div className={classes.quotaRow}>
        <div className={classes.quotaRowHeader}>
          <span className={classes.quotaModel}>{t('cursor_quota.on_demand')}</span>
          <span>
            {t(
              quota.onDemandEnabled === null
                ? 'cursor_quota.unknown'
                : quota.onDemandEnabled
                  ? 'cursor_quota.enabled'
                  : 'cursor_quota.disabled'
            )}
          </span>
        </div>
        {quota.onDemandEnabled === true && quota.onDemandLimit !== null && (
          <div className={classes.quotaMessage}>
            {t('cursor_quota.monthly_limit', { amount: money(quota.onDemandLimit) })}
          </div>
        )}
      </div>
      <details>
        <summary>{t('cursor_quota.local_usage')}</summary>
        <div className={classes.quotaMessage}>{t('cursor_quota.scope')}</div>
        {quota.summary.map((metric) => (
          <div className={classes.quotaRow} key={metric.key}>
            <div className={classes.quotaRowHeader}>
              <span className={classes.quotaModel}>{t(`cursor_quota.${metric.key}`)}</span>
              <span className={classes.quotaAmount}>
                {metric.value.toLocaleString(i18n.language)}
              </span>
            </div>
          </div>
        ))}
      </details>
    </>
  );
}
