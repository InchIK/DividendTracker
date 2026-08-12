/**
 * Database row types — mirror the schema after migrations/0002_dynamic_instruments_prices.sql.
 *
 * D1 stores booleans as 0/1 integers; convert them at route boundaries.
 */

export type Market = 'twse' | 'tpex';
export type InstrumentKind = 'stock' | 'etf';

// ── instruments / watchlist ────────────────────────────────────────────────
export interface InstrumentRow {
  instrument_id: string;
  market: Market;
  code: string;
  kind: InstrumentKind;
  display_name: string;
  active: 0 | 1;
  metadata_source: string | null;
  metadata_observed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WatchlistRow {
  user_id: string;
  instrument_id: string;
  display_name_override: string | null;
  current_shares: number;
  enabled: 0 | 1;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Compatibility projection used by the existing portfolio routes. */
export interface PortfolioRow extends InstrumentRow, WatchlistRow {}

export interface WatchlistItemRow extends InstrumentRow, WatchlistRow {}

export type SelectedPriceInstrumentRow = Pick<
  InstrumentRow,
  'instrument_id' | 'market' | 'code'
>;

export interface WatchlistCreateInput {
  market: Market;
  code: string;
  kind: InstrumentKind;
  displayName: string;
  shares: number;
  enabled: boolean;
  metadataSource?: 'twse_t187ap03_L' | 'twse_t187ap47_L' | 'tpex_mopsfin_t187ap03_O';
}

export interface WatchlistUpdateInput {
  shares?: number;
  enabled?: boolean;
  displayName?: string;
}

// ── fund_mapping ───────────────────────────────────────────────────────────
export interface FundMappingRow {
  instrument_id: string;
  /** Compatibility projection from instruments for the existing adapters. */
  code: string;
  fund_unified_no: string | null;
  fund_name: string | null;
  source_kind: string;
  source_observed_at: string;
  updated_at: string;
}

// ── dividend_events ────────────────────────────────────────────────────────
export interface DividendEventRow {
  event_key: string;
  instrument_id: string;
  /** Compatibility projection from instruments for current API/domain code. */
  code: string;
  ex_date: string;
  base_date: string | null;
  pay_date: string | null;
  dividend_micros: number | null;
  eligible_shares_override: number | null;
  status: string;
  canonical_source_kind: string;
  canonical_source_priority: number;
  manual_locked: 0 | 1;
  manual_note: string | null;
  owner_user_id: string | null;
  created_at: string;
  updated_at: string;
}

// ── dividend_observations ──────────────────────────────────────────────────
export interface DividendObservationRow {
  observation_key: string;
  event_key: string;
  source_kind: string;
  source_priority: number;
  source_url: string | null;
  ex_date: string | null;
  base_date: string | null;
  pay_date: string | null;
  dividend_micros: number | null;
  source_observed_at: string;
  payload_sha256: string;
  raw_payload: string;
  created_at: string;
}

// ── prices ─────────────────────────────────────────────────────────────────
export type MarketState = 'trading' | 'closed' | 'halted' | 'no_trade' | 'unknown';
export type PriceStatus = 'complete' | 'partial' | 'not_covered' | 'stale' | 'error';

export interface LatestPriceRow {
  instrument_id: string;
  price_micros: number | null;
  previous_close_micros: number | null;
  trade_date: string | null;
  trade_time: string | null;
  market_state: MarketState;
  status: PriceStatus;
  source: string;
  observed_at: string;
  stale: 0 | 1;
  error_message: string | null;
  updated_at: string;
}

export interface WatchlistPriceRow {
  instrument_id: string;
  code: string;
  display_name: string;
  latest_price_micros: string | null;
  previous_close_micros: string | null;
  trade_date: string | null;
  trade_time: string | null;
  market_state: MarketState | null;
  status: PriceStatus | null;
  source: string | null;
  observed_at: string | null;
  stale: 0 | 1;
  error_message: string | null;
}

export interface PriceObservationRow {
  observation_key: string;
  instrument_id: string;
  price_micros: number | null;
  previous_close_micros: number | null;
  trade_date: string | null;
  trade_time: string | null;
  market_state: MarketState;
  status: PriceStatus;
  source: string;
  http_status: number | null;
  observed_at: string;
  payload_sha256: string;
  raw_payload: string;
  error_message: string | null;
  created_at: string;
}

export interface PriceSnapshotWrite {
  observationKey: string;
  instrumentId: string;
  priceMicros: number | null;
  previousCloseMicros: number | null;
  tradeDate: string | null;
  tradeTime: string | null;
  marketState: MarketState;
  status: PriceStatus;
  source: string;
  httpStatus: number | null;
  observedAt: string;
  stale: boolean;
  payloadSha256: string;
  rawPayload: string;
  errorMessage: string | null;
}

// ── sync_runs ──────────────────────────────────────────────────────────────
export type SyncRunStatus = 'running' | 'success' | 'partial' | 'failed';
export type TriggerKind = 'cron' | 'manual' | 'startup' | 'test';

export interface SyncRunRow {
  id: number;
  trigger_kind: TriggerKind;
  started_at: string;
  finished_at: string | null;
  status: SyncRunStatus;
  mapping_rows_read: number;
  schedule_rows_read: number;
  dividend_rows_read: number;
  observations_applied: number;
  events_changed: number;
  newest_source_date: string | null;
  error_code: string | null;
  error_message: string | null;
}

// ── source_status ──────────────────────────────────────────────────────────
export type SourceStatusValue = 'never' | 'ok' | 'stale' | 'error';

export interface SourceStatusRow {
  source_kind: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_http_status: number | null;
  last_payload_sha256: string | null;
  newest_source_date: string | null;
  status: SourceStatusValue;
  error_message: string | null;
  updated_at: string;
}
