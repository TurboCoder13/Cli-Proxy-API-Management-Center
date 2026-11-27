/**
 * Gemini subscription usage, read from a file the owner saved by hand.
 *
 * Google offers no quota API for consumer plans and does not support polling its
 * CLI from an application. The owner therefore runs the official CLI's `/usage`
 * command themselves and stores the output as an inert file beside the
 * credentials. This card only downloads and displays that file: it never signs
 * in, never holds a Google token and never calls Google.
 */

import type {
  AntigravityQuotaSummaryBucketPayload,
  AntigravityQuotaSummaryGroupPayload,
} from '@/types';
import { authFilesApi } from '@/services/api/authFiles';
import { isRecord } from '@/utils/helpers';
import {
  buildAntigravityQuotaGroups,
  isDisabledAuthFile,
  resolveAuthProvider,
} from '@/utils/quota';
import type { QuotaProviderData } from '../types';
import {
  GEMINI_SNAPSHOT_PROVIDER,
  emptyGeminiSnapshot,
  type GeminiSnapshotQuotaData,
  type GeminiSnapshotQuotaState,
} from './types';

const MAX_GROUPS = 16;
const MAX_BUCKETS = 16;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const parseInstant = (value: unknown): number | null => {
  const raw = text(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
};

/** The CLI reports the Unix epoch for limits that have no pending reset. */
const resetTimeOf = (value: unknown): string | undefined => {
  const ms = parseInstant(value);
  return ms !== null && ms > 0 ? text(value) : undefined;
};

const toBucket = (bucket: unknown): AntigravityQuotaSummaryBucketPayload[] => {
  if (!isRecord(bucket)) return [];
  const fraction = bucket.remaining_fraction;
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return [];
  return [
    {
      bucketId: text(bucket.id),
      displayName: text(bucket.name),
      window: text(bucket.window),
      remainingFraction: fraction,
      resetTime: resetTimeOf(bucket.reset_time),
      description: text(bucket.description),
    },
  ];
};

const toGroup = (group: unknown): AntigravityQuotaSummaryGroupPayload[] => {
  if (!isRecord(group) || !Array.isArray(group.buckets)) return [];
  return [
    {
      displayName: text(group.name),
      description: text(group.description),
      buckets: group.buckets.slice(0, MAX_BUCKETS).flatMap(toBucket),
    },
  ];
};

/**
 * Parse a saved snapshot. The usage block is the CLI's own `command.data` object;
 * a raw `agy -p /usage --output-format json` capture is accepted as well.
 */
export function parseGeminiUsageSnapshot(source: string): GeminiSnapshotQuotaData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('Invalid Gemini usage snapshot');
  }
  if (!isRecord(parsed)) throw new Error('Invalid Gemini usage snapshot');

  const usage = isRecord(parsed.usage)
    ? parsed.usage
    : isRecord(parsed.command) && isRecord(parsed.command.data)
      ? parsed.command.data
      : null;
  if (!usage || !Array.isArray(usage.groups)) throw new Error('Invalid Gemini usage snapshot');

  return {
    groups: buildAntigravityQuotaGroups({
      groups: usage.groups.slice(0, MAX_GROUPS).flatMap(toGroup),
    }),
    capturedAtMs: parseInstant(parsed.captured_at),
  };
}

/** Resets that fell between the snapshot and now: those rows no longer reflect reality. */
export function countResetsSinceSnapshot(
  data: Pick<GeminiSnapshotQuotaData, 'groups' | 'capturedAtMs'>,
  nowMs: number
): number {
  return data.groups
    .flatMap((group) => group.buckets)
    .filter(
      (bucket) =>
        typeof bucket.resetAtMs === 'number' &&
        bucket.resetAtMs > 0 &&
        bucket.resetAtMs <= nowMs &&
        (data.capturedAtMs === null || data.capturedAtMs < bucket.resetAtMs)
    ).length;
}

export const GEMINI_SNAPSHOT_CONFIG: QuotaProviderData<
  GeminiSnapshotQuotaState,
  GeminiSnapshotQuotaData
> = {
  type: GEMINI_SNAPSHOT_PROVIDER,
  i18nPrefix: 'gemini_snapshot_quota',
  filterFn: (file) =>
    resolveAuthProvider(file) === GEMINI_SNAPSHOT_PROVIDER &&
    !isDisabledAuthFile(file) &&
    file.runtimeOnly !== true &&
    file.runtime_only !== true,
  fetchQuota: async (file) => parseGeminiUsageSnapshot(await authFilesApi.downloadText(file.name)),
  storeSelector: (state) => state.geminiSnapshotQuota,
  storeSetter: 'setGeminiSnapshotQuota',
  buildLoadingState: () => ({ ...emptyGeminiSnapshot(), status: 'loading' }),
  buildSuccessState: (data) => ({ ...data, status: 'success' }),
  buildErrorState: (error, errorStatus) => ({
    ...emptyGeminiSnapshot(),
    status: 'error',
    error,
    errorStatus,
  }),
};
