import { Hono } from 'hono';
import { requireAdmin, type AuthEnv } from '../auth/bearer';
import { searchOfficialInstruments } from '../sources/instrument-search';

export const instrumentRoutes = new Hono<AuthEnv>();

instrumentRoutes.use('/api/v1/instruments/*', requireAdmin());

instrumentRoutes.get('/api/v1/instruments/search', async (c) => {
  const query = c.req.query('query')?.trim() ?? '';
  if (query.length < 2 || query.length > 50) {
    return c.json({ error: '請輸入至少 2 個字元，最多 50 個字元' }, 400);
  }
  try {
    return c.json(await searchOfficialInstruments(query));
  } catch (error) {
    return c.json({
      error: '官方標的查詢目前無法使用',
      details: error instanceof Error ? error.message : String(error),
    }, 502);
  }
});
