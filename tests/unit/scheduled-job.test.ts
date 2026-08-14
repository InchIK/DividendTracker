import { describe, expect, it } from 'vitest';

import { decideScheduledJobs, SCHEDULER_CRON } from '../../worker/sync/scheduled-job';

const atUtc = (value: string): number => Date.parse(`${value}Z`);

describe('minute scheduler decision', () => {
  it('uses a single Cloudflare cron expression', () => {
    expect(SCHEDULER_CRON).toBe('* * * * *');
  });

  it('keeps the daily job idle before the configured Taipei minute', () => {
    expect(decideScheduledJobs(atUtc('2026-08-13T05:34:00'), '13:35')).toMatchObject({
      dailyDue: false,
      hourlyPriceDue: false,
      taipeiDate: '2026-08-13',
      taipeiTime: '13:34',
    });
  });

  it('converts UTC to Taipei time and marks the configured daily minute', () => {
    expect(decideScheduledJobs(atUtc('2026-08-13T05:35:00'), '13:35')).toMatchObject({
      dailyDue: true,
      hourlyPriceDue: false,
      taipeiDate: '2026-08-13',
      taipeiTime: '13:35',
    });
  });

  it('keeps the daily job due after the configured minute on the same day', () => {
    expect(decideScheduledJobs(atUtc('2026-08-13T06:10:00'), '13:35')).toMatchObject({
      dailyDue: true,
      hourlyPriceDue: false,
      taipeiDate: '2026-08-13',
      taipeiTime: '14:10',
    });
  });

  it('marks every local整點 for hourly prices', () => {
    expect(decideScheduledJobs(atUtc('2026-08-13T00:00:00'), '13:35')).toMatchObject({
      dailyDue: false,
      hourlyPriceDue: true,
      taipeiDate: '2026-08-13',
      taipeiTime: '08:00',
    });
  });

  it('allows daily and hourly jobs to be due on the same minute', () => {
    expect(decideScheduledJobs(atUtc('2026-08-13T05:00:00'), '13:00')).toMatchObject({
      dailyDue: true,
      hourlyPriceDue: true,
      taipeiDate: '2026-08-13',
    });
  });

  it('handles the Taipei midnight date boundary', () => {
    expect(decideScheduledJobs(atUtc('2026-08-13T16:00:00'), '13:35')).toMatchObject({
      dailyDue: false,
      hourlyPriceDue: true,
      taipeiDate: '2026-08-14',
      taipeiTime: '00:00',
    });
  });

  it('starts the next Taipei day below its configured minute', () => {
    expect(decideScheduledJobs(atUtc('2026-08-14T04:00:00'), '13:35')).toMatchObject({
      dailyDue: false,
      hourlyPriceDue: true,
      taipeiDate: '2026-08-14',
      taipeiTime: '12:00',
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects an invalid scheduled timestamp: %s',
    (scheduledTime) => {
      expect(() => decideScheduledJobs(scheduledTime, '13:35')).toThrow('finite');
    },
  );
});
