type InstrumentKind = 'stock' | 'etf';

export async function getSelectedTwseCodes(
  db: D1Database,
  kind: InstrumentKind | null = null,
): Promise<Set<string>> {
  const { results } = await db.prepare(
    `SELECT DISTINCT i.code
     FROM watchlist AS w
     JOIN instruments AS i ON i.instrument_id = w.instrument_id
     WHERE w.enabled = 1 AND w.archived_at IS NULL AND i.active = 1
       AND i.market = 'twse' AND (?1 IS NULL OR i.kind = ?1)
     ORDER BY i.code`,
  ).bind(kind).all<{ code: string }>();
  return new Set((results ?? []).map((row) => row.code));
}
