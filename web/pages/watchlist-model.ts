import type {
  CreateWatchlistItemPayload,
  UpdateWatchlistItemPayload,
  WatchlistItemDTO,
  WatchlistStatus,
} from '@/api/client';

export interface EditableWatchlistItem extends WatchlistItemDTO {
  sharesText: string;
}

export interface WatchlistDraft {
  market: CreateWatchlistItemPayload['market'];
  code: string;
  kind: CreateWatchlistItemPayload['kind'];
  displayName: string;
  sharesText: string;
  enabled: boolean;
}

export type WatchlistDraftErrors = Partial<Record<'code' | 'displayName' | 'sharesText', string>>;

const SHARES_PATTERN = /^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/;
const CODE_PATTERN = /^[0-9][0-9A-Z]{3,5}$/;

export function parseSharesInput(text: string): number | null {
  const value = text.trim();
  if (!SHARES_PATTERN.test(value)) return null;
  const shares = Number(value.replaceAll(',', ''));
  return Number.isSafeInteger(shares) ? shares : null;
}

export function validateWatchlistDraft(draft: WatchlistDraft): WatchlistDraftErrors {
  const errors: WatchlistDraftErrors = {};
  if (!CODE_PATTERN.test(draft.code.trim().toUpperCase())) {
    errors.code = '代碼需為 4 至 6 碼英數字，第一碼必須是數字。';
  }
  if (!draft.displayName.trim()) errors.displayName = '請輸入名稱。';
  if (parseSharesInput(draft.sharesText) === null) {
    errors.sharesText = '股數請輸入 0 以上的整數，可使用千分位逗號。';
  }
  return errors;
}

export function buildWatchlistPatch(
  original: WatchlistItemDTO,
  row: EditableWatchlistItem,
): UpdateWatchlistItemPayload {
  const patch: UpdateWatchlistItemPayload = {};
  if (row.displayName.trim() !== original.displayName) patch.displayName = row.displayName.trim();
  if (row.shares !== original.shares) patch.shares = row.shares;
  if (row.enabled !== original.enabled) patch.enabled = row.enabled;
  return patch;
}

export function watchlistStatusLabel(status: WatchlistStatus): string {
  return status === 'pending_validation' ? '等待資料來源確認' : '資料來源已確認';
}
