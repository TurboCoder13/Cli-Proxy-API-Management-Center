import type { QuotaProviderType } from './providers/types';

/** tab 顺序 = 旧页五分区的纵向顺序，'全部' tab 下卡片也按此分组排列。 */
export const QUOTA_TAB_ORDER: readonly QuotaProviderType[] = [
  'claude',
  'antigravity',
  'codex',
  'xai',
  'kimi',
  'devin',
  'meta',
  'cursor-local',
  'gemini-usage-snapshot',
  'plugin',
];

export type QuotaTabId = 'all' | QuotaProviderType;

/** Public account pages; never attach proxy credentials or account identifiers. */
export const QUOTA_USAGE_LINKS: Record<
  QuotaProviderType,
  { url: string; isGuide?: boolean } | null
> = {
  claude: { url: 'https://claude.ai/new#settings/usage' },
  codex: { url: 'https://chatgpt.com/settings/usage?tab=overview' },
  'cursor-local': { url: 'https://cursor.com/dashboard?tab=usage' },
  // Antigravity reports usage in its app Settings, without a public usage dashboard.
  antigravity: { url: 'https://antigravity.google/docs/plans', isGuide: true },
  kimi: { url: 'https://www.kimi.com/code/console' },
  devin: { url: 'https://app.devin.ai/settings/usage' },
  meta: { url: 'https://dev.meta.ai' },
  xai: { url: 'https://grok.com/?_s=usage' },
  // Same reason as antigravity: Google shows consumer usage only inside its own clients.
  'gemini-usage-snapshot': { url: 'https://antigravity.google/docs/plans', isGuide: true },
  plugin: null,
};

/** 页级分页固定 20/页，同时把「刷新全部」的上游并发限制在 20。 */
export const QUOTA_PAGE_SIZE = 20;

/** 卡片排序：默认 = provider 分组序；soonest = 最快恢复优先。 */
export const QUOTA_SORT_MODES = ['default', 'soonest'] as const;

export type QuotaSortMode = (typeof QUOTA_SORT_MODES)[number];

/** Card layout (Even rows / Stacked / Compact), kept in localStorage across sessions. */
export const QUOTA_CARD_LAYOUT_KEY = 'quotaPage.cardLayout';

/** Column minimums and gaps for the Stacked and Compact layouts; Even rows uses `.grid`. */
export const QUOTA_STACKED_COLUMNS = { minColumnWidth: 340, gap: 16 } as const;
export const QUOTA_COMPACT_COLUMNS = { minColumnWidth: 260, gap: 10 } as const;

/** 与 useRevealGroup 的 GROUP_MAX_TOTAL 一致：卡片级联总预算 360ms。 */
export const CARD_ENTRANCE_BUDGET_MS = 360;
