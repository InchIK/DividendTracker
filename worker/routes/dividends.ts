/**
 * Dividend routes.
 * GET    /api/v1/dividends                    — list events (filter by year/month)
 * POST   /api/v1/dividends/manual             — manual verified insert/update
 * POST   /api/v1/dividends/:eventKey/unlock   — unlock a manually locked event
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { authUserId, requireAdmin, type AuthEnv } from '../auth/bearer';
import {
  getUserDividendEvents,
  getUserDividendEvent,
  getObservations,
  manualDividendUpsert,
  unlockEvent,
  getPortfolio,
} from '../db/queries';
import { formatMicros, parseDecimalToMicros } from '../domain/money';
import { PeriodFilterError, parsePeriodFilter } from '../domain/period-filter';
import type { DividendEventRow, PortfolioRow } from '../db/types';

export const dividendRoutes = new Hono<AuthEnv>();

dividendRoutes.use('/api/v1/dividends/*', requireAdmin());

// GET /api/v1/dividends?year=&month=&code=
dividendRoutes.get('/api/v1/dividends', async (c) => {
  const db = c.env.DB;
  const userId = authUserId(c);
  const yearParam = c.req.query('year');
  const monthParam = c.req.query('month');
  const codeParam = c.req.query('code');

  let prefix: string | null;
  try {
    prefix = parsePeriodFilter(yearParam, monthParam, false).prefix;
  } catch (error) {
    if (error instanceof PeriodFilterError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }

  // If prefix is null (no filter), get all events
  let events: DividendEventRow[];
  if (prefix) {
    events = await getUserDividendEvents(db, userId, prefix);
  } else {
    // Get all events by passing null prefix
    events = await getUserDividendEvents(db, userId, null);
  }

  // Filter by code if specified
  if (codeParam) {
    events = events.filter((e) => e.code === codeParam);
  }

  const portfolio = await getPortfolio(db, userId);
  const portfolioMap = new Map(portfolio.map((p: PortfolioRow) => [p.code, p]));

  const items = await Promise.all(
    events.map(async (e: DividendEventRow) => {
      const port = portfolioMap.get(e.code);
      const observations = await getObservations(db, e.event_key);
      return {
        eventKey: e.event_key,
        code: e.code,
        displayName: port?.display_name ?? e.code,
        exDate: e.ex_date,
        baseDate: e.base_date,
        payDate: e.pay_date,
        dividendMicros: e.dividend_micros,
        dividendPerUnit: e.dividend_micros !== null ? formatMicros(BigInt(e.dividend_micros)) : null,
        eligibleSharesOverride: e.eligible_shares_override,
        shares: e.eligible_shares_override ?? port?.current_shares ?? 0,
        status: e.status,
        source: e.canonical_source_kind,
        sourcePriority: e.canonical_source_priority,
        manualLocked: e.manual_locked === 1,
        manualNote: e.manual_note,
        createdAt: e.created_at,
        updatedAt: e.updated_at,
        observations: observations.map((o) => ({
          sourceKind: o.source_kind,
          sourcePriority: o.source_priority,
          exDate: o.ex_date,
          baseDate: o.base_date,
          payDate: o.pay_date,
          dividendMicros: o.dividend_micros,
          dividendPerUnit: o.dividend_micros !== null ? formatMicros(BigInt(o.dividend_micros)) : null,
          observedAt: o.source_observed_at,
          rawPayload: JSON.parse(o.raw_payload) as unknown,
        })),
      };
    }),
  );

  return c.json({ items });
});

// POST /api/v1/dividends/manual
const manualDividendSchema = z.object({
  eventKey: z.string().regex(/^(?:twse|tpex):[0-9][0-9A-Z]{3,5}:\d{4}-\d{2}-\d{2}$/).optional(),
  instrumentId: z.string().regex(/^(?:twse|tpex):[0-9][0-9A-Z]{3,5}$/).optional(),
  exDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  baseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  payDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  dividendPerUnit: z.string().optional().nullable(),
  eligibleShares: z.number().int().min(0).nullable().optional(),
  note: z.string().nullable().optional(),
  lock: z.boolean().default(true),
}).superRefine((value, context) => {
  if (!value.eventKey && (!value.instrumentId || !value.exDate)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '必須提供 eventKey，或 instrumentId 與 exDate' });
  }
});

dividendRoutes.post('/api/v1/dividends/manual', async (c) => {
  const body = await c.req.json<unknown>();
  const parsed = manualDividendSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: '請求格式錯誤', details: parsed.error.flatten() }, 400);

  const data = parsed.data;
  const userId = authUserId(c);
  const existing = data.eventKey ? await getUserDividendEvent(c.env.DB, userId, data.eventKey) : null;
  if (data.eventKey && !existing) return c.json({ error: '找不到此配息事件' }, 404);
  const instrumentId = existing?.instrument_id ?? data.instrumentId;
  const exDate = existing?.ex_date ?? data.exDate;
  if (!instrumentId || !exDate) return c.json({ error: '缺少標的或除息日' }, 400);

  let dividendMicros: number | null = existing?.dividend_micros ?? null;
  if (data.dividendPerUnit !== undefined) {
    if (data.dividendPerUnit === null || data.dividendPerUnit.trim() === '') dividendMicros = null;
    else {
      try {
        const micros = parseDecimalToMicros(data.dividendPerUnit);
        dividendMicros = micros === null ? null : Number(micros);
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : '配息金額格式錯誤' }, 400);
      }
    }
  }

  const result = await manualDividendUpsert(c.env.DB, userId, {
    instrumentId,
    exDate,
    baseDate: data.baseDate === undefined ? existing?.base_date ?? null : data.baseDate,
    payDate: data.payDate === undefined ? existing?.pay_date ?? null : data.payDate,
    dividendMicros,
    eligibleSharesOverride: data.eligibleShares === undefined ? existing?.eligible_shares_override ?? null : data.eligibleShares,
    manualNote: data.note === undefined ? existing?.manual_note ?? null : data.note,
  }, data.lock);

  return c.json({
    ok: true as const,
    eventKey: result.event_key,
    status: result.status,
    manualLocked: result.manual_locked === 1,
    message: '已成功寫入人工覆核資料',
  });
});

// POST /api/v1/dividends/:eventKey/unlock
dividendRoutes.post('/api/v1/dividends/:eventKey/unlock', async (c) => {
  const eventKey = c.req.param('eventKey');
  const userId = authUserId(c);
  const existing = await getUserDividendEvent(c.env.DB, userId, eventKey);
  if (!existing) {
    return c.json({ error: '找不到此配息事件' }, 404);
  }

  await unlockEvent(c.env.DB, userId, eventKey);
  return c.json({ eventKey, message: '已解除人工鎖定' });
});
