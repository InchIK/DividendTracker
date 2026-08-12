import { runFinmindDividendSync } from './run-finmind-dividend-sync';
import { runPriceSync } from './run-price-sync';

export interface InstrumentRefreshResult {
  status: 'success' | 'partial' | 'failed';
  dividend: Awaited<ReturnType<typeof runFinmindDividendSync>>;
  prices: Awaited<ReturnType<typeof runPriceSync>>;
  errors: string[];
}

/** Immediate one-year dividend backfill plus latest quote refresh for configured symbols. */
export async function runInstrumentRefresh(
  env: Env,
  instrumentIds: ReadonlySet<string>,
): Promise<InstrumentRefreshResult> {
  // History and quote refreshes are independent. Always attempt both so an
  // upstream outage cannot prevent the other half of a newly configured
  // instrument from being populated immediately.
  const [dividendAttempt, priceAttempt] = await Promise.allSettled([
    runFinmindDividendSync(env, { instrumentIds }),
    runPriceSync(env, { instrumentIds }),
  ]);
  const dividend = dividendAttempt.status === 'fulfilled'
    ? dividendAttempt.value
    : {
      outcome: 'rejected' as const,
      selected: instrumentIds.size,
      rowsRead: 0,
      observationsApplied: 0,
      eventsChanged: 0,
      errors: [`股利回補失敗：${errorMessage(dividendAttempt.reason)}`],
    };
  const prices = priceAttempt.status === 'fulfilled'
    ? priceAttempt.value
    : {
      outcome: 'failed' as const,
      selected: instrumentIds.size,
      persisted: 0,
      complete: 0,
      partial: 0,
      stale: 0,
      errors: [`行情更新失敗：${errorMessage(priceAttempt.reason)}`],
      sources: {},
    };
  const errors = [
    ...dividend.errors,
    ...prices.errors,
  ];
  const dividendFailed = dividend.outcome === 'rejected';
  const pricesFailed = prices.outcome === 'failed';
  const partial = dividend.outcome === 'partial' || prices.outcome === 'partial' || errors.length > 0;
  return {
    status: dividendFailed && pricesFailed ? 'failed' : partial || dividendFailed || pricesFailed ? 'partial' : 'success',
    dividend,
    prices,
    errors,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
