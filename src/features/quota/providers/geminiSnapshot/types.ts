import type { AntigravityQuotaGroup } from '@/types';

/**
 * Provider key of the saved-usage file. It is deliberately neither `gemini` nor
 * `antigravity`: the backend must never treat the file as a usable credential.
 */
export const GEMINI_SNAPSHOT_PROVIDER = 'gemini-usage-snapshot';

export interface GeminiSnapshotQuotaData {
  groups: AntigravityQuotaGroup[];
  /** When the owner ran the CLI's usage command; null when the file does not say. */
  capturedAtMs: number | null;
}

export interface GeminiSnapshotQuotaState extends GeminiSnapshotQuotaData {
  status: 'idle' | 'loading' | 'success' | 'error';
  error?: string;
  errorStatus?: number;
}

export const emptyGeminiSnapshot = (): GeminiSnapshotQuotaData => ({
  groups: [],
  capturedAtMs: null,
});
