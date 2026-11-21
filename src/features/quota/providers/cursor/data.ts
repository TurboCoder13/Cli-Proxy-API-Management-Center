import { cursorQuotaApi } from '@/services/api/cursorQuota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { isDisabledAuthFile } from '@/utils/quota';
import type { QuotaProviderData } from '../types';
import { emptyCursorQuota, type CursorQuotaState, type CursorQuotaData } from './types';

export const CURSOR_CONFIG: QuotaProviderData<CursorQuotaState, CursorQuotaData> = {
  type: 'cursor-local',
  i18nPrefix: 'cursor_quota',
  filterFn: (file) =>
    (file.provider ?? file.type) === 'cursor-local' &&
    !isDisabledAuthFile(file) &&
    file.runtimeOnly !== true &&
    file.runtime_only !== true,
  fetchQuota: async (file, t) => {
    const index = normalizeAuthIndex(file.auth_index ?? file.authIndex);
    if (!index) throw new Error(t('cursor_quota.missing_auth_index'));
    return cursorQuotaApi.fetch(index);
  },
  storeSelector: (state) => state.cursorQuota,
  storeSetter: 'setCursorQuota',
  buildLoadingState: () => ({ ...emptyCursorQuota(), status: 'loading' }),
  buildSuccessState: (data) => ({ ...data, status: 'success' }),
  buildErrorState: (error, errorStatus) => ({
    ...emptyCursorQuota(),
    status: 'error',
    error,
    errorStatus,
  }),
};
