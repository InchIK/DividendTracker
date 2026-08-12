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
 *   GET/PUT /api/v1/widget/settings          — Widget solid/gradient background (admin)
 *   GET  /api/v1/dashboard                   — period dashboard (admin)
 *   GET  /api/v1/dividends                   — dividend events (admin)
 *   POST /api/v1/dividends/manual            — manual verified entry (admin)
 *   POST /api/v1/dividends/:eventKey/unlock — unlock (admin)
 *   POST /api/v1/sync                        — trigger dividend sync (admin)
 *   GET  /api/v1/sync/runs                   — sync history (admin)
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
import { scheduledJobForCron } from './sync/scheduled-job';
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
    event: ScheduledEvent,
    env: Env,
  ): Promise<void> {
    if (scheduledJobForCron(event.cron) === 'prices') {
      console.log('Hourly selected-symbol price sync triggered at', event.scheduledTime);
      const result = await runPriceSync(env);
      console.log(
        `Price sync ${result.outcome}: ${result.persisted}/${result.selected} selected instruments persisted`,
      );
      if (result.errors.length > 0) console.error('Price sync errors:', result.errors.join('; '));
      return;
    }

    console.log('Daily 13:35 Asia/Taipei sync triggered at', new Date().toISOString());
    const result = await runSync(env, 'cron');
    console.log(
      `Sync ${result.status}: ${result.observationsApplied} observations, ${result.eventsChanged} events changed`,
    );
    if (result.errors.length > 0) {
      console.error('Sync errors:', result.errors.join('; '));
    }
    const prices = await runPriceSync(env);
    console.log(
      `Daily price sync ${prices.outcome}: ${prices.persisted}/${prices.selected} instruments persisted`,
    );
    if (prices.errors.length > 0) console.error('Price sync errors:', prices.errors.join('; '));
  },
};
