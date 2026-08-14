/**
 * DividendTracker — Worker entry point.
 * Cloudflare Workers + Hono + D1.
 *
 * Routes:
 *   GET  /health                             — liveness probe (no auth)
 *   GET  /api/v1/health/upstream             — upstream health (admin)
 *   GET  /api/v1/instruments/search          — official metadata search (admin)
 *   GET  /api/v1/watchlist                   — active watchlist (admin)
 *   POST /api/v1/watchlist                   — add or restore an instrument (admin)
 *   PATCH/DELETE /api/v1/watchlist/:id       — edit or archive an instrument (admin)
 *   GET  /api/v1/prices                      — selected latest prices (admin)
 *   GET  /api/v1/widget/current              — legacy one-period widget (per-user Widget credential)
 *   GET  /api/v1/widget/upcoming             — current/next periods (per-user Widget credential)
 *   GET/PUT /api/v1/widget/settings          — Widget appearance/preferences (user)
 *   GET  /api/v1/dashboard                   — period dashboard (admin)
 *   GET  /api/v1/dividends                   — dividend events (admin)
 *   POST /api/v1/dividends/manual            — manual verified entry (admin)
 *   POST /api/v1/dividends/:eventKey/unlock — unlock (admin)
 *   POST /api/v1/sync                        — trigger dividend sync (admin)
 *   GET  /api/v1/sync/runs                   — sync history (user)
 *   GET/PUT /api/v1/sync/settings            — daily schedule (user/owner)
 *   GET  /api/v1/sources/status              — source freshness (admin)
 */
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { healthRoutes } from './routes/health';
import { widgetRoutes } from './routes/widget';
import { dashboardRoutes } from './routes/dashboard';
import { dividendRoutes } from './routes/dividends';
import { syncRoutes } from './routes/sync';
import { instrumentRoutes } from './routes/instruments';
import { watchlistRoutes } from './routes/watchlist';
import { priceRoutes } from './routes/prices';
import { widgetUpcomingRoutes } from './routes/widget-upcoming';
import { widgetSettingsRoutes } from './routes/widget-settings';
import { runSync } from './sync/run-sync';
import { runPriceSync } from './sync/run-price-sync';
import { decideScheduledJobs } from './sync/scheduled-job';
import {
  claimDailySyncDate,
  completeDailySyncDate,
  getSyncSchedule,
} from './sync/schedule-settings';
import { authRoutes } from './routes/auth';
import type { AuthContextEnv } from './auth/session';

const app = new Hono<AuthContextEnv>();

function withApiCacheHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('Pragma', 'no-cache');
  const vary = new Map<string, string>();
  for (const value of (headers.get('Vary') ?? '').split(',')) {
    const trimmed = value.trim();
    if (trimmed) vary.set(trimmed.toLowerCase(), trimmed);
  }
  vary.set('cookie', 'Cookie');
  vary.set('authorization', 'Authorization');
  headers.set('Vary', [...vary.values()].join(', '));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ── Middleware ───────────────────────────────────────────────────────────────
app.use('*', logger());
app.use(
  '*',
  secureHeaders({
    xContentTypeOptions: 'nosniff',
    xDnsPrefetchControl: 'off',
    referrerPolicy: 'no-referrer',
  }),
);

app.use('/api/v1/*', async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = c.req.header('Origin');
    if (!origin || origin !== new URL(c.req.url).origin) {
      return withApiCacheHeaders(c.json({ error: '請使用同源請求' }, 403));
    }
  }

  await next();
  c.res = withApiCacheHeaders(c.res);
  return undefined;
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.route('/', healthRoutes);
app.route('/', authRoutes);
app.route('/', widgetRoutes);
app.route('/', dashboardRoutes);
app.route('/', dividendRoutes);
app.route('/', syncRoutes);
app.route('/', instrumentRoutes);
app.route('/', watchlistRoutes);
app.route('/', priceRoutes);
app.route('/', widgetUpcomingRoutes);
app.route('/', widgetSettingsRoutes);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.notFound((c) => {
  // Don't leak API path for unknown routes
  return c.json({ error: '找不到此路徑' }, 404);
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: '伺服器內部錯誤' }, 500);
});

// ── Cloudflare Workers fetch handler ──────────────────────────────────────────
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return app.fetch(req, env);
  },

  // ── Cron trigger handler ────────────────────────────────────────────────────
  async scheduled(
    event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    void ctx;
    const schedule = await getSyncSchedule(env.DB);
    const decision = decideScheduledJobs(event.scheduledTime, schedule.dailyTime);
    if (!decision.dailyDue && !decision.hourlyPriceDue) return;

    let dailyClaimed = false;
    let dailyError: unknown;
    let dailyFailed = false;
    if (decision.dailyDue) {
      dailyClaimed = await claimDailySyncDate(env.DB, decision.taipeiDate);
      console.log(JSON.stringify({
        message: 'daily sync claim',
        job: 'daily',
        outcome: dailyClaimed ? 'claimed' : 'already_claimed',
        taipeiDate: decision.taipeiDate,
      }));
      if (dailyClaimed) {
        try {
          const result = await runSync(env, 'cron');
          console.log(JSON.stringify({
            message: 'daily sync completed',
            job: 'daily',
            outcome: result.status,
            observationsApplied: result.observationsApplied,
            eventsChanged: result.eventsChanged,
          }));
          if (result.errors.length > 0) console.error(JSON.stringify({
            message: 'daily sync errors',
            job: 'daily',
            errors: result.errors,
          }));
          if (result.status === 'success' || result.status === 'partial') {
            await completeDailySyncDate(env.DB, decision.taipeiDate);
          }
        } catch (error) {
          dailyError = error;
          dailyFailed = true;
          console.error(JSON.stringify({
            message: 'daily sync threw',
            job: 'daily',
            outcome: 'error',
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }
    }

    // A claimed daily run includes exactly one price pass, even when the
    // dividend sync throws.  Otherwise retain the hourly pass at the top of
    // the hour when this invocation did not claim the daily lease.
    if (dailyClaimed || decision.hourlyPriceDue) {
      try {
        const result = await runPriceSync(env);
        console.log(JSON.stringify({
          message: 'price sync completed',
          job: dailyClaimed ? 'daily_prices' : 'hourly_prices',
          outcome: result.outcome,
          persisted: result.persisted,
          selected: result.selected,
        }));
        if (result.errors.length > 0) console.error(JSON.stringify({
          message: 'price sync errors',
          job: dailyClaimed ? 'daily_prices' : 'hourly_prices',
          errors: result.errors,
        }));
      } catch (error) {
        console.error(JSON.stringify({
          message: 'price sync threw',
          job: dailyClaimed ? 'daily_prices' : 'hourly_prices',
          outcome: 'error',
          error: error instanceof Error ? error.message : String(error),
        }));
        if (!dailyFailed) throw error;
      }
    }

    // Preserve the original daily exception after the required price pass has
    // had a chance to run so Cloudflare records the failed invocation.
    if (dailyFailed) {
      throw dailyError;
    }
  },
} satisfies ExportedHandler<Env>;
