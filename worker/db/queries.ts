/**
 * D1 query layer — all database access for DividendTracker.
 */
import type {
  PortfolioRow,
  FundMappingRow,
  DividendEventRow,
  DividendObservationRow,
  SyncRunRow,
  SourceStatusRow,
  TriggerKind,
  WatchlistCreateInput,
  WatchlistItemRow,
  WatchlistPriceRow,
  WatchlistUpdateInput,
} from './types';

function instrumentIdFromEventKey(eventKey: string, code: string, exDate: string): string {
  const suffix = `:${exDate}`;
  if (eventKey.endsWith(suffix)) {
    const candidate = eventKey.slice(0, -suffix.length);
    if (candidate.includes(':')) return candidate;
  }
  return code.includes(':') ? code : `twse:${code}`;
}

// ── Portfolio ──────────────────────────────────────────────────────────────

export async function getPortfolio(db: D1Database, userId: string): Promise<PortfolioRow[]> {
  const { results } = await db.prepare(
    `SELECT w.user_id, i.instrument_id, i.market, i.code, i.kind,
            COALESCE(w.display_name_override, i.display_name) AS display_name,
            w.display_name_override, i.active,
            i.metadata_source, i.metadata_observed_at,
            w.current_shares, w.enabled, w.archived_at, w.created_at, w.updated_at
     FROM watchlist AS w
     JOIN instruments AS i ON i.instrument_id = w.instrument_id
     WHERE w.user_id = ? AND w.archived_at IS NULL
     ORDER BY i.market, i.code`,
  ).bind(userId).all<PortfolioRow>();
  return results ?? [];
}

export async function updatePortfolio(
  db: D1Database,
  userId: string,
  items: { code: string; current_shares: number; enabled: boolean; display_name?: string | undefined }[],
): Promise<void> {
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  for (const item of items) {
    stmts.push(
      db.prepare(
        `UPDATE watchlist
         SET current_shares = ?, enabled = ?, updated_at = ?
         WHERE user_id = ? AND instrument_id = 'twse:' || ?`,
      )
        .bind(item.current_shares, item.enabled ? 1 : 0, now, userId, item.code),
      db.prepare(
        `UPDATE watchlist
         SET display_name_override = COALESCE(NULLIF(?, ''), display_name_override), updated_at = ?
         WHERE user_id = ? AND instrument_id = 'twse:' || ?`,
      ).bind(item.display_name ?? null, now, userId, item.code),
    );
  }
  await db.batch(stmts);
}

// ── Dynamic watchlist ──────────────────────────────────────────────────────

const watchlistSelect = `SELECT w.user_id, i.instrument_id, i.market, i.code, i.kind,
                                COALESCE(w.display_name_override, i.display_name) AS display_name,
                                w.display_name_override,
                                i.active, i.metadata_source, i.metadata_observed_at,
                                i.created_at, i.updated_at, w.current_shares, w.enabled,
                                w.archived_at, w.created_at, w.updated_at
                         FROM watchlist AS w
                         JOIN instruments AS i ON i.instrument_id = w.instrument_id`;

export async function getWatchlist(db: D1Database, userId: string): Promise<WatchlistItemRow[]> {
  const { results } = await db.prepare(
    `${watchlistSelect}
     WHERE w.user_id = ? AND i.active = 1 AND w.archived_at IS NULL
     ORDER BY i.market, i.code`,
  ).bind(userId).all<WatchlistItemRow>();
  return results ?? [];
}

export async function getWatchlistPrices(db: D1Database, userId: string): Promise<WatchlistPriceRow[]> {
  const { results } = await db.prepare(
    `SELECT i.instrument_id, i.code,
            COALESCE(w.display_name_override, i.display_name) AS display_name,
            CAST(p.price_micros AS TEXT) AS latest_price_micros,
            CAST(p.previous_close_micros AS TEXT) AS previous_close_micros,
            p.trade_date, p.trade_time, p.market_state, p.status, p.source,
            p.observed_at, COALESCE(p.stale, 0) AS stale, p.error_message
     FROM watchlist AS w
     JOIN instruments AS i ON i.instrument_id = w.instrument_id
     LEFT JOIN latest_prices AS p ON p.instrument_id = w.instrument_id
     WHERE w.user_id = ? AND w.archived_at IS NULL
     ORDER BY i.market, i.code`,
  ).bind(userId).all<WatchlistPriceRow>();
  return results ?? [];
}

export async function getWatchlistItem(
  db: D1Database,
  userId: string,
  instrumentId: string,
): Promise<WatchlistItemRow | null> {
  return await db.prepare(
    `${watchlistSelect} WHERE w.user_id = ? AND i.instrument_id = ?`,
  ).bind(userId, instrumentId).first<WatchlistItemRow>();
}

export async function createOrRestoreWatchlistItem(
  db: D1Database,
  userId: string,
  input: WatchlistCreateInput,
): Promise<{ item: WatchlistItemRow; restored: boolean } | null> {
  const instrumentId = `${input.market}:${input.code}`;
  const existing = await getWatchlistItem(db, userId, instrumentId);
  if (existing?.archived_at === null) return null;

  const now = new Date().toISOString();
  const metadataSource = input.metadataSource ?? 'user_pending_validation';
  const metadataObservedAt = input.metadataSource ? now : null;
  await db.batch([
    db.prepare(
      `INSERT INTO instruments
         (instrument_id, market, code, kind, display_name, active, metadata_source,
          metadata_observed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
       ON CONFLICT(instrument_id) DO UPDATE SET
         active = 1,
         updated_at = excluded.updated_at`,
    ).bind(
      instrumentId,
      input.market,
      input.code,
      input.kind,
      input.displayName,
      metadataSource,
      metadataObservedAt,
      now,
      now,
    ),
    db.prepare(
      `INSERT INTO watchlist
         (user_id, instrument_id, display_name_override, current_shares, enabled, archived_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(user_id, instrument_id) DO UPDATE SET
         display_name_override = excluded.display_name_override,
         current_shares = excluded.current_shares,
         enabled = excluded.enabled,
         archived_at = NULL,
         updated_at = excluded.updated_at`,
    ).bind(userId, instrumentId, input.displayName, input.shares, input.enabled ? 1 : 0, now, now),
  ]);

  const item = await getWatchlistItem(db, userId, instrumentId);
  if (!item) throw new Error('Watchlist write did not return an item');
  return { item, restored: existing !== null };
}

export async function updateWatchlistItem(
  db: D1Database,
  userId: string,
  instrumentId: string,
  input: WatchlistUpdateInput,
): Promise<WatchlistItemRow | null> {
  const existing = await getWatchlistItem(db, userId, instrumentId);
  if (existing?.archived_at !== null) return null;

  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `UPDATE watchlist
       SET current_shares = ?, enabled = ?, display_name_override = ?, updated_at = ?
       WHERE user_id = ? AND instrument_id = ? AND archived_at IS NULL`,
    ).bind(
      input.shares ?? existing.current_shares,
      (input.enabled ?? existing.enabled === 1) ? 1 : 0,
      input.displayName ?? existing.display_name_override,
      now,
      userId,
      instrumentId,
    ),
  ]);
  return await getWatchlistItem(db, userId, instrumentId);
}

export async function archiveWatchlistItem(
  db: D1Database,
  userId: string,
  instrumentId: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db.prepare(
    `UPDATE watchlist SET enabled = 0, archived_at = ?, updated_at = ?
     WHERE user_id = ? AND instrument_id = ? AND archived_at IS NULL`,
  ).bind(now, now, userId, instrumentId).run();
  return result.meta.changes === 1;
}

// ── Fund Mapping ────────────────────────────────────────────────────────────

export async function getFundMapping(db: D1Database, code: string): Promise<FundMappingRow | null> {
  return (
    (await db
      .prepare(
        `SELECT fm.*, i.code
         FROM fund_mapping AS fm
         JOIN instruments AS i ON i.instrument_id = fm.instrument_id
         WHERE i.instrument_id = 'twse:' || ?`,
      )
      .bind(code)
      .first<FundMappingRow>()) ?? null
  );
}

export async function getSelectedFundMappings(db: D1Database): Promise<FundMappingRow[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT fm.*, i.code
       FROM fund_mapping AS fm
       JOIN instruments AS i ON i.instrument_id = fm.instrument_id
       JOIN watchlist AS w ON w.instrument_id = i.instrument_id
       WHERE w.enabled = 1 AND w.archived_at IS NULL AND i.active = 1
         AND i.market = 'twse' AND i.kind = 'etf'
       ORDER BY i.market, i.code`,
    )
    .all<FundMappingRow>();
  return results ?? [];
}

export async function upsertFundMapping(
  db: D1Database,
  code: string,
  fundUnifiedNo: string | null,
  fundName: string | null,
  sourceKind: string,
  sourceObservedAt: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO fund_mapping (instrument_id, fund_unified_no, fund_name, source_kind, source_observed_at, updated_at)
       VALUES ('twse:' || ?, ?, ?, ?, ?, ?)
       ON CONFLICT(instrument_id) DO UPDATE SET
         fund_unified_no = COALESCE(excluded.fund_unified_no, fund_mapping.fund_unified_no),
         fund_name = COALESCE(excluded.fund_name, fund_mapping.fund_name),
         source_kind = excluded.source_kind,
         source_observed_at = excluded.source_observed_at,
         updated_at = excluded.updated_at`,
    )
    .bind(code, fundUnifiedNo, fundName, sourceKind, sourceObservedAt, now)
    .run();
}

// ── Dividend Events ──────────────────────────────────────────────────────────

export async function getDividendEvents(
  db: D1Database,
  yearMonthPrefix: string | null,
): Promise<DividendEventRow[]> {
  if (yearMonthPrefix === null) {
    const { results } = await db
      .prepare(
        `SELECT e.*, i.code
         FROM dividend_events AS e
         JOIN instruments AS i ON i.instrument_id = e.instrument_id
         ORDER BY e.pay_date DESC NULLS LAST, e.ex_date DESC`,
      )
      .all<DividendEventRow>();
    return results ?? [];
  }
  const { results } = await db
    .prepare(
      `SELECT e.*, i.code
       FROM dividend_events AS e
       JOIN instruments AS i ON i.instrument_id = e.instrument_id
       WHERE e.pay_date IS NOT NULL AND e.pay_date LIKE ? || '%'
       ORDER BY e.pay_date ASC`,
    )
    .bind(yearMonthPrefix)
    .all<DividendEventRow>();
  return results ?? [];
}

const userDividendSelect = `SELECT
  e.event_key,
  e.instrument_id,
  i.code,
  e.ex_date,
  CASE WHEN o.user_id IS NOT NULL THEN o.base_date ELSE e.base_date END AS base_date,
  CASE WHEN o.user_id IS NOT NULL THEN o.pay_date ELSE e.pay_date END AS pay_date,
  CASE WHEN o.user_id IS NOT NULL THEN o.dividend_micros ELSE e.dividend_micros END AS dividend_micros,
  CASE WHEN o.user_id IS NOT NULL THEN o.eligible_shares_override ELSE e.eligible_shares_override END AS eligible_shares_override,
  CASE WHEN o.user_id IS NOT NULL THEN 'verified' ELSE e.status END AS status,
  CASE WHEN o.user_id IS NOT NULL THEN 'manual_verified' ELSE e.canonical_source_kind END AS canonical_source_kind,
  CASE WHEN o.user_id IS NOT NULL THEN 100 ELSE e.canonical_source_priority END AS canonical_source_priority,
  COALESCE(o.manual_locked, 0) AS manual_locked,
  CASE WHEN o.user_id IS NOT NULL THEN o.manual_note ELSE NULL END AS manual_note,
  e.owner_user_id,
  e.created_at,
  CASE WHEN o.user_id IS NOT NULL THEN o.updated_at ELSE e.updated_at END AS updated_at
FROM dividend_events AS e
JOIN instruments AS i ON i.instrument_id = e.instrument_id
JOIN watchlist AS w
  ON w.instrument_id = e.instrument_id
 AND w.user_id = ?1
 AND w.archived_at IS NULL
LEFT JOIN user_dividend_overrides AS o
  ON o.event_key = e.event_key
 AND o.user_id = ?1`;

/** Return only events visible to a user's current watchlist, with private overrides applied. */
export async function getUserDividendEvents(
  db: D1Database,
  userId: string,
  yearMonthPrefix: string | null,
): Promise<DividendEventRow[]> {
  const periodClause = yearMonthPrefix === null
    ? ''
    : `AND (CASE WHEN o.user_id IS NOT NULL THEN o.pay_date ELSE e.pay_date END) LIKE ?2 || '%'`;
  const { results } = await db.prepare(
    `${userDividendSelect}
     WHERE (e.owner_user_id IS NULL OR e.owner_user_id = ?1 OR o.user_id IS NOT NULL)
     ${periodClause}
     ORDER BY pay_date ${yearMonthPrefix === null ? 'DESC NULLS LAST' : 'ASC'}, e.ex_date DESC`,
  ).bind(...(yearMonthPrefix === null ? [userId] : [userId, yearMonthPrefix]))
    .all<DividendEventRow>();
  return results ?? [];
}

export async function getUserDividendEvent(
  db: D1Database,
  userId: string,
  eventKey: string,
): Promise<DividendEventRow | null> {
  return db.prepare(
    `${userDividendSelect}
     WHERE e.event_key = ?2
       AND (e.owner_user_id IS NULL OR e.owner_user_id = ?1 OR o.user_id IS NOT NULL)
     LIMIT 1`,
  ).bind(userId, eventKey).first<DividendEventRow>();
}

export async function getDividendEvent(
  db: D1Database,
  eventKey: string,
): Promise<DividendEventRow | null> {
  return (
    (await db
      .prepare(
        `SELECT e.*, i.code
         FROM dividend_events AS e
         JOIN instruments AS i ON i.instrument_id = e.instrument_id
         WHERE e.event_key = ?`,
      )
      .bind(eventKey)
      .first<DividendEventRow>()) ?? null
  );
}

export async function getDividendEventByCodeAndExDate(
  db: D1Database,
  code: string,
  exDate: string,
): Promise<DividendEventRow | null> {
  return (
    (await db
      .prepare(
        `SELECT e.*, i.code
         FROM dividend_events AS e
         JOIN instruments AS i ON i.instrument_id = e.instrument_id
         WHERE i.instrument_id = 'twse:' || ? AND e.ex_date = ?`,
      )
      .bind(code, exDate)
      .first<DividendEventRow>()) ?? null
  );
}

export async function upsertDividendEvent(
  db: D1Database,
  event: {
    eventKey: string;
    code: string;
    exDate: string;
    baseDate: string | null;
    payDate: string | null;
    dividendMicros: number | null;
    status: string;
    canonicalSourceKind: string;
    canonicalSourcePriority: number;
    manualLocked: boolean;
    manualNote: string | null;
  },
): Promise<boolean> {
  const now = new Date().toISOString();
  const instrumentId = instrumentIdFromEventKey(event.eventKey, event.code, event.exDate);
  const eventKey = `${instrumentId}:${event.exDate}`;
  const existing = await getDividendEvent(db, eventKey);

  // Never overwrite manually locked events with auto-sync data
  if (existing?.manual_locked === 1 && !event.manualLocked) {
    return false;
  }

  await db
    .prepare(
      `INSERT INTO dividend_events (
         event_key, instrument_id, ex_date, base_date, pay_date, dividend_micros,
         eligible_shares_override, status, canonical_source_kind,
         canonical_source_priority, manual_locked, manual_note, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_key) DO UPDATE SET
         base_date = COALESCE(excluded.base_date, dividend_events.base_date),
         pay_date = COALESCE(excluded.pay_date, dividend_events.pay_date),
         dividend_micros = COALESCE(excluded.dividend_micros, dividend_events.dividend_micros),
         status = excluded.status,
         canonical_source_kind = excluded.canonical_source_kind,
         canonical_source_priority = excluded.canonical_source_priority,
         updated_at = excluded.updated_at`,
    )
    .bind(
      eventKey,
      instrumentId,
      event.exDate,
      event.baseDate,
      event.payDate,
      event.dividendMicros,
      event.status,
      event.canonicalSourceKind,
      event.canonicalSourcePriority,
      event.manualLocked ? 1 : 0,
      event.manualNote,
      now,
      now,
    )
    .run();
  // During a rolling migration the column may not exist yet. Once 0005 is
  // applied, an official observation promotes a formerly private placeholder
  // to a shared canonical event.
  try {
    await db.prepare('UPDATE dividend_events SET owner_user_id = NULL WHERE event_key = ?')
      .bind(eventKey).run();
  } catch {
    // Pre-0005 databases are supported only for migration/test compatibility.
  }
  return true;
}

// ── Manual Dividend Upsert ───────────────────────────────────────────────────

export async function manualDividendUpsert(
  db: D1Database,
  userId: string,
  data: {
    instrumentId: string;
    exDate: string;
    baseDate?: string | null;
    payDate: string | null;
    dividendMicros: number | null;
    eligibleSharesOverride?: number | null;
    manualNote?: string | null;
  },
  lock: boolean,
): Promise<DividendEventRow> {
  const instrumentId = data.instrumentId;
  const eventKey = `${instrumentId}:${data.exDate}`;
  const now = new Date().toISOString();
  const existing = await getDividendEvent(db, eventKey);
  const selected = await getWatchlistItem(db, userId, instrumentId);
  if (selected?.archived_at !== null) {
    throw new Error('Instrument is not in this user watchlist');
  }

  if (!existing) {
    await db
      .prepare(
        `INSERT INTO dividend_events (
           event_key, instrument_id, ex_date, base_date, pay_date, dividend_micros,
           eligible_shares_override, status, canonical_source_kind,
           canonical_source_priority, manual_locked, manual_note, owner_user_id, created_at, updated_at
         ) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 'schedule_only',
                   'manual_placeholder', 0, 0, NULL, ?, ?, ?)`,
      )
      .bind(
        eventKey,
        instrumentId,
        data.exDate,
        userId,
        now,
        now,
      )
      .run();
  }

  await db.prepare(
    `INSERT INTO user_dividend_overrides (
       user_id, event_key, base_date, pay_date, dividend_micros,
       eligible_shares_override, manual_locked, manual_note, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, event_key) DO UPDATE SET
       base_date = excluded.base_date,
       pay_date = excluded.pay_date,
       dividend_micros = excluded.dividend_micros,
       eligible_shares_override = excluded.eligible_shares_override,
       manual_locked = excluded.manual_locked,
       manual_note = excluded.manual_note,
       updated_at = excluded.updated_at`,
  ).bind(
    userId,
    eventKey,
    data.baseDate ?? null,
    data.payDate,
    data.dividendMicros,
    data.eligibleSharesOverride ?? null,
    lock ? 1 : 0,
    data.manualNote ?? null,
    now,
    now,
  ).run();
  const result = await getUserDividendEvent(db, userId, eventKey);
  if (!result) throw new Error('Manual dividend write did not return an event');
  return result;
}

// ── Unlock ────────────────────────────────────────────────────────────────

export async function unlockEvent(db: D1Database, userId: string, eventKey: string): Promise<void> {
  await db.prepare(
    `DELETE FROM user_dividend_overrides WHERE user_id = ? AND event_key = ?`,
  ).bind(userId, eventKey).run();
}

// ── Observations ─────────────────────────────────────────────────────────────

export async function insertObservation(
  db: D1Database,
  obs: {
    observationKey: string;
    eventKey: string;
    sourceKind: string;
    sourcePriority: number;
    sourceUrl: string | null;
    exDate: string | null;
    baseDate: string | null;
    payDate: string | null;
    dividendMicros: number | null;
    sourceObservedAt: string;
    payloadSha256: string;
    rawPayload: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO dividend_observations (
         observation_key, event_key, source_kind, source_priority, source_url,
         ex_date, base_date, pay_date, dividend_micros,
         source_observed_at, payload_sha256, raw_payload, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      obs.observationKey,
      obs.eventKey,
      obs.sourceKind,
      obs.sourcePriority,
      obs.sourceUrl,
      obs.exDate,
      obs.baseDate,
      obs.payDate,
      obs.dividendMicros,
      obs.sourceObservedAt,
      obs.payloadSha256,
      obs.rawPayload,
      now,
    )
    .run();
}

export async function getObservations(
  db: D1Database,
  eventKey: string,
): Promise<DividendObservationRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM dividend_observations WHERE event_key = ? ORDER BY source_priority DESC`,
    )
    .bind(eventKey)
    .all<DividendObservationRow>();
  return results ?? [];
}

// ── Sync Runs ───────────────────────────────────────────────────────────────

export async function createSyncRun(
  db: D1Database,
  triggerKind: TriggerKind,
): Promise<number> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO sync_runs (trigger_kind, started_at, status)
       VALUES (?, ?, 'running')`,
    )
    .bind(triggerKind, now)
    .run();
  const row = await db
    .prepare('SELECT id FROM sync_runs ORDER BY id DESC LIMIT 1')
    .first<{ id: number }>();
  return row?.id ?? 0;
}

export async function updateSyncRun(
  db: D1Database,
  id: number,
  updates: Partial<Pick<SyncRunRow, 'status' | 'finished_at' | 'mapping_rows_read' | 'schedule_rows_read' | 'dividend_rows_read' | 'observations_applied' | 'events_changed' | 'newest_source_date' | 'error_code' | 'error_message'>>,
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (fields.length === 0) return;
  values.push(id);
  await db.prepare(`UPDATE sync_runs SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function getSyncRuns(
  db: D1Database,
  limit = 50,
): Promise<SyncRunRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?')
    .bind(limit)
    .all<SyncRunRow>();
  return results ?? [];
}

// ── Source Status ────────────────────────────────────────────────────────────

export async function getSourceStatus(db: D1Database): Promise<SourceStatusRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM source_status ORDER BY source_kind')
    .all<SourceStatusRow>();
  return results ?? [];
}

export async function upsertSourceStatus(
  db: D1Database,
  source: {
    sourceKind: string;
    lastAttemptAt?: string | null;
    lastSuccessAt?: string | null;
    lastHttpStatus?: number | null;
    lastPayloadSha256?: string | null;
    newestSourceDate?: string | null;
    status: 'never' | 'ok' | 'stale' | 'error';
    errorMessage?: string | null;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO source_status (
         source_kind, last_attempt_at, last_success_at, last_http_status,
         last_payload_sha256, newest_source_date, status, error_message, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_kind) DO UPDATE SET
         last_attempt_at = COALESCE(excluded.last_attempt_at, source_status.last_attempt_at),
         last_success_at = COALESCE(excluded.last_success_at, source_status.last_success_at),
         last_http_status = COALESCE(excluded.last_http_status, source_status.last_http_status),
         last_payload_sha256 = COALESCE(excluded.last_payload_sha256, source_status.last_payload_sha256),
         newest_source_date = COALESCE(excluded.newest_source_date, source_status.newest_source_date),
         status = excluded.status,
         error_message = excluded.error_message,
         updated_at = excluded.updated_at`,
    )
    .bind(
      source.sourceKind,
      source.lastAttemptAt ?? null,
      source.lastSuccessAt ?? null,
      source.lastHttpStatus ?? null,
      source.lastPayloadSha256 ?? null,
      source.newestSourceDate ?? null,
      source.status,
      source.errorMessage ?? null,
      now,
    )
    .run();
}

export async function getLatestSuccessfulSync(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare(`SELECT finished_at FROM sync_runs WHERE status IN ('success', 'partial') ORDER BY id DESC LIMIT 1`)
    .first<{ finished_at: string }>();
  return row?.finished_at ?? null;
}
