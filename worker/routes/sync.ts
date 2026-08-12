/**
 * Sync routes.
 * POST /api/v1/sync          — admin auth, triggers sync (202 + run ID)
 * GET  /api/v1/sync/runs     — admin auth, recent sync runs
 * GET  /api/v1/sources/status — admin auth, source freshness
 */
import { Hono } from 'hono';
import { requireAdmin, type AuthEnv } from '../auth/bearer';
import { getSyncRuns } from '../db/queries';
import { runSync } from '../sync/run-sync';
import { runPriceSync } from '../sync/run-price-sync';
import { checkSourceHealth } from '../sync/source-health';
import type { TriggerKind } from '../db/types';

export const syncRoutes = new Hono<AuthEnv>();

syncRoutes.use('/api/v1/sync/*', requireAdmin());
syncRoutes.use('/api/v1/sources/*', requireAdmin());

// POST /api/v1/sync
syncRoutes.post('/api/v1/sync', async (c) => {
  const triggerParam = c.req.query('trigger');
  const allowedTriggers = ['manual', 'cron', 'startup'] as const satisfies readonly Exclude<TriggerKind, 'test'>[];
  const isAllowedTrigger = (value: string): value is Exclude<TriggerKind, 'test'> => (
    allowedTriggers.some((allowed) => allowed === value)
  );
  if (triggerParam !== undefined && !isAllowedTrigger(triggerParam)) {
    return c.json({ error: '無效的同步觸發類型' }, 400);
  }
  const trigger: Exclude<TriggerKind, 'test'> = triggerParam ?? 'manual';
  const result = await runSync(c.env, trigger);
  const prices = await runPriceSync(c.env);

  return c.json(
    {
      runId: result.runId,
      status: result.status,
      mappingRows: result.mappingRows,
      scheduleRows: result.scheduleRows,
      dividendRows: result.dividendRows,
      finmindRows: result.finmindRows,
      observationsApplied: result.observationsApplied,
      eventsChanged: result.eventsChanged,
      errors: result.errors,
      prices,
    },
    202,
  );
});

// GET /api/v1/sync/runs
syncRoutes.get('/api/v1/sync/runs', async (c) => {
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 200) : 50;
  const runs = await getSyncRuns(c.env.DB, limit);

  return c.json({
    items: runs.map((r) => ({
      id: r.id,
      triggerKind: r.trigger_kind,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      status: r.status,
      mappingRowsRead: r.mapping_rows_read,
      scheduleRowsRead: r.schedule_rows_read,
      dividendRowsRead: r.dividend_rows_read,
      observationsApplied: r.observations_applied,
      eventsChanged: r.events_changed,
      newestSourceDate: r.newest_source_date,
      errorCode: r.error_code,
      errorMessage: r.error_message,
    })),
  });
});

// GET /api/v1/sources/status
syncRoutes.get('/api/v1/sources/status', async (c) => {
  const { sources, anyStale } = await checkSourceHealth(c.env.DB);
  return c.json({
    sources: sources.map((s) => ({
      sourceKind: s.sourceKind,
      status: s.status,
      stale: s.stale,
      lastSuccessAt: s.lastSuccessAt,
      hoursSinceLastSuccess: s.hoursSinceLastSuccess,
      errorMessage: s.errorMessage,
    })),
    anyStale,
  });
});
