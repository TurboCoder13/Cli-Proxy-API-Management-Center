import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { PluginQuotaBody } from '../plugin/PluginQuotaBody';
import type { QuotaBodyProps } from '../../types';
import { countResetsSinceSnapshot } from './data';
import type { GeminiSnapshotQuotaState } from './types';

/**
 * Saved Gemini usage. The numbers are only as fresh as the owner's last manual
 * run, so the capture time leads and any reset that has passed since is called out.
 */
export function GeminiSnapshotQuotaBody({
  quota,
  classes,
}: QuotaBodyProps<GeminiSnapshotQuotaState>) {
  const { t } = useTranslation();
  // Shared minute clock: the stale note appears once a reset passes, without a reload.
  const nowMs = useNow();
  const capturedAt =
    quota.capturedAtMs === null
      ? t('gemini_snapshot_quota.captured_unknown')
      : new Date(quota.capturedAtMs).toLocaleString();
  const passedResets = countResetsSinceSnapshot(quota, nowMs);

  return (
    <>
      <div className={classes.codexPlan}>
        <span className={classes.codexPlanItem} data-quota-snapshot="">
          <span className={classes.codexPlanLabel}>
            {t('gemini_snapshot_quota.captured_label')}
          </span>
          <span className={classes.codexPlanValue}>{capturedAt}</span>
        </span>
      </div>
      <div className={classes.quotaMessage}>
        {t(
          passedResets > 0
            ? 'gemini_snapshot_quota.stale_note'
            : 'gemini_snapshot_quota.manual_note'
        )}
      </div>
      <PluginQuotaBody
        quota={{ status: quota.status, groups: quota.groups, subscription: null, summary: [] }}
        classes={classes}
      />
    </>
  );
}
