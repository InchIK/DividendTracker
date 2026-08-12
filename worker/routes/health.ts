/**
 * Health check routes.
 * GET /health           — no auth, liveness probe
 * GET /api/v1/health/upstream — admin auth, checks upstream source connectivity
 */
import { Hono } from 'hono';
import { requireAdmin, type AuthEnv } from '../auth/bearer';

export const healthRoutes = new Hono<AuthEnv>();

// GET /health — no auth
healthRoutes.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'dividend-tracker',
    timestamp: new Date().toISOString(),
  });
});

// GET /api/v1/health/upstream — admin auth
healthRoutes.use('/api/v1/health/upstream', requireAdmin());
healthRoutes.get('/api/v1/health/upstream', async (c) => {
  const db = c.env.DB;
  const { getSourceStatus } = await import('../db/queries');
  const statuses = await getSourceStatus(db);

  const upstream = statuses.map((s) => ({
    source: s.source_kind,
    status: s.status,
    lastAttempt: s.last_attempt_at,
    lastSuccess: s.last_success_at,
    httpStatus: s.last_http_status,
    errorMessage: s.error_message,
  }));

  const allOk = upstream.every((u) => u.status === 'ok');
  return c.json({
    status: allOk ? 'ok' : 'degraded',
    sources: upstream,
  });
});
