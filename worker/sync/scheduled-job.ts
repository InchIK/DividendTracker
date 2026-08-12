export const HOURLY_PRICE_CRON = '0 * * * *';
/** 13:35 Asia/Taipei. Cloudflare Cron Triggers execute in UTC. */
export const DAILY_REFRESH_CRON = '35 5 * * *';

export function scheduledJobForCron(cron: string): 'prices' | 'daily' {
  return cron === HOURLY_PRICE_CRON ? 'prices' : 'daily';
}
