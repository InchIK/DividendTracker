import { describe, expect, it } from 'vitest';

import { DAILY_REFRESH_CRON, HOURLY_PRICE_CRON, scheduledJobForCron } from '../../worker/sync/scheduled-job';

describe('scheduled job routing', () => {
  it('routes the hourly expression only to selected-symbol price synchronization', () => {
    expect(scheduledJobForCron(HOURLY_PRICE_CRON)).toBe('prices');
    expect(DAILY_REFRESH_CRON).toBe('35 5 * * *');
    expect(scheduledJobForCron(DAILY_REFRESH_CRON)).toBe('daily');
  });
});
