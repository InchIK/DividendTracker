/**
 * Sync orchestration — fetches all 3 sources, writes observations, reconciles canonical events.
 *
 * Single source failure = partial, all fail = failed, no existing data modified on full failure.
 */
import { fetchTwseFundMapping } from '../sources/twse-fund-mapping';
import { fetchTwseExDividend } from '../sources/twse-ex-dividend';
import { fetchSitcaDividendCsv } from '../sources/sitca-dividend-csv';
import {
  getSelectedFundMappings,
  upsertFundMapping,
  createSyncRun,
  updateSyncRun,
  upsertSourceStatus,
} from '../db/queries';
import type { TriggerKind } from '../db/types';
import {
  applyObservationGroups,
} from './apply-observations';
import { runEtfortuneYearlySync } from './run-etfortune-sync';
import { runFinmindDividendSync } from './run-finmind-dividend-sync';

export { applyObservationGroups, type SyncObservationQueries } from './apply-observations';

export interface SyncResult {
  runId: number;
  status: 'success' | 'partial' | 'failed';
  mappingRows: number;
  scheduleRows: number;
  dividendRows: number;
  etfortuneRows: number;
  finmindRows: number;
  observationsApplied: number;
  eventsChanged: number;
  errors: string[];
}

export interface SyncDependencies {
  fetchTwseFundMapping: typeof fetchTwseFundMapping;
  fetchTwseExDividend: typeof fetchTwseExDividend;
  fetchSitcaDividendCsv: typeof fetchSitcaDividendCsv;
  getSelectedFundMappings: typeof getSelectedFundMappings;
  upsertFundMapping: typeof upsertFundMapping;
  createSyncRun: typeof createSyncRun;
  updateSyncRun: typeof updateSyncRun;
  upsertSourceStatus: typeof upsertSourceStatus;
  runEtfortuneYearlySync: typeof runEtfortuneYearlySync;
  runFinmindDividendSync: typeof runFinmindDividendSync;
}

const defaultDependencies: SyncDependencies = {
  fetchTwseFundMapping,
  fetchTwseExDividend,
  fetchSitcaDividendCsv,
  getSelectedFundMappings,
  upsertFundMapping,
  createSyncRun,
  updateSyncRun,
  upsertSourceStatus,
  runEtfortuneYearlySync,
  runFinmindDividendSync,
};

export async function runSync(
  env: Env,
  triggerKind: TriggerKind = 'manual',
  dependencyOverrides: Partial<SyncDependencies> = {},
): Promise<SyncResult> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const db = env.DB;
  const runId = await dependencies.createSyncRun(db, triggerKind);
  const errors: string[] = [];
  let observationsApplied = 0;
  let eventsChanged = 0;
  let mappingRows = 0;
  let scheduleRows = 0;
  let dividendRows = 0;
  let etfortuneRows = 0;
  let finmindRows = 0;

  try {
    const now = new Date().toISOString();

    const mappingResult = await dependencies.fetchTwseFundMapping(env);
    if (mappingResult.error) {
      errors.push(`twse_fund_mapping: ${mappingResult.error}`);
      await dependencies.upsertSourceStatus(db, {
        sourceKind: 'twse_fund_mapping',
        lastAttemptAt: now,
        lastHttpStatus: mappingResult.httpStatus,
        status: 'error',
        errorMessage: mappingResult.error,
      });
    } else {
      for (const observation of mappingResult.observations) {
        await dependencies.upsertFundMapping(
          db,
          observation.code,
          observation.fundUnifiedNo,
          (observation.rawPayload as { 基金簡稱?: string })['基金簡稱'] ?? null,
          'twse_fund_mapping',
          observation.observedAt,
        );
        mappingRows++;
      }
      await dependencies.upsertSourceStatus(db, {
        sourceKind: 'twse_fund_mapping',
        lastAttemptAt: now,
        lastSuccessAt: now,
        lastHttpStatus: mappingResult.httpStatus,
        lastPayloadSha256: mappingResult.payloadSha256,
        newestSourceDate: mappingResult.newestSourceDate,
        status: 'ok',
        errorMessage: null,
      });
    }

    const scheduleResult = await dependencies.fetchTwseExDividend(env);
    if (scheduleResult.error) {
      errors.push(`twse_ex_schedule: ${scheduleResult.error}`);
      await dependencies.upsertSourceStatus(db, {
        sourceKind: 'twse_ex_schedule',
        lastAttemptAt: now,
        lastHttpStatus: scheduleResult.httpStatus,
        status: 'error',
        errorMessage: scheduleResult.error,
      });
    } else {
      await dependencies.upsertSourceStatus(db, {
        sourceKind: 'twse_ex_schedule',
        lastAttemptAt: now,
        lastSuccessAt: now,
        lastHttpStatus: scheduleResult.httpStatus,
        lastPayloadSha256: scheduleResult.payloadSha256,
        newestSourceDate: scheduleResult.newestSourceDate,
        status: 'ok',
        errorMessage: null,
      });
      scheduleRows = scheduleResult.rowsRead;
    }

    const fundMappings = await dependencies.getSelectedFundMappings(db);
    const sitcaResult = await dependencies.fetchSitcaDividendCsv(env, fundMappings);
    if (sitcaResult.error) {
      errors.push(`sitca_open_data: ${sitcaResult.error}`);
      await dependencies.upsertSourceStatus(db, {
        sourceKind: 'sitca_open_data',
        lastAttemptAt: now,
        lastHttpStatus: sitcaResult.httpStatus,
        status: 'error',
        errorMessage: sitcaResult.error,
      });
    } else {
      await dependencies.upsertSourceStatus(db, {
        sourceKind: 'sitca_open_data',
        lastAttemptAt: now,
        lastSuccessAt: now,
        lastHttpStatus: sitcaResult.httpStatus,
        lastPayloadSha256: sitcaResult.payloadSha256,
        newestSourceDate: sitcaResult.newestSourceDate,
        status: 'ok',
        errorMessage: null,
      });
      dividendRows = sitcaResult.rowsRead;
    }

    const structuredAllFailed =
      mappingResult.error !== null &&
      scheduleResult.error !== null &&
      sitcaResult.error !== null;

    if (!structuredAllFailed) {
      const applied = await applyObservationGroups(
        db,
        [...scheduleResult.observations, ...sitcaResult.observations],
      );
      observationsApplied = applied.observationsApplied;
      eventsChanged = applied.eventsChanged;
    }

    // Backfill every configured stock/ETF for at least one year. This runs before
    // e添富 so the higher-priority official ETF table remains canonical.
    const finmindResult = await dependencies.runFinmindDividendSync(env);
    finmindRows = finmindResult.rowsRead;
    dividendRows += finmindRows;
    observationsApplied += finmindResult.observationsApplied;
    eventsChanged += finmindResult.eventsChanged;
    if (finmindResult.outcome === 'partial' || finmindResult.outcome === 'rejected') {
      errors.push(...finmindResult.errors.map((error) => `finmind_dividend: ${error}`));
    }

    const etfortuneResult = await dependencies.runEtfortuneYearlySync(env);
    etfortuneRows = etfortuneResult.selectedRows;
    dividendRows += etfortuneRows;
    observationsApplied += etfortuneResult.observationsApplied;
    eventsChanged += etfortuneResult.eventsChanged;
    if (etfortuneResult.outcome === 'rejected') {
      errors.push(`etfortune_html: ${etfortuneResult.error ?? 'rejected without an error message'}`);
    }

    const allFailed = structuredAllFailed
      && finmindResult.outcome !== 'success'
      && finmindResult.outcome !== 'partial'
      && etfortuneResult.outcome !== 'success';

    const status: SyncResult['status'] =
      allFailed ? 'failed' : errors.length > 0 ? 'partial' : 'success';
    await dependencies.updateSyncRun(db, runId, {
      status,
      finished_at: new Date().toISOString(),
      mapping_rows_read: mappingRows,
      schedule_rows_read: scheduleRows,
      dividend_rows_read: dividendRows,
      observations_applied: observationsApplied,
      events_changed: eventsChanged,
      error_message: errors.join('; ') || null,
    });

    return {
      runId,
      status,
      mappingRows,
      scheduleRows,
      dividendRows,
      etfortuneRows,
      finmindRows,
      observationsApplied,
      eventsChanged,
      errors,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await dependencies.updateSyncRun(db, runId, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        mapping_rows_read: mappingRows,
        schedule_rows_read: scheduleRows,
        dividend_rows_read: dividendRows,
        observations_applied: observationsApplied,
        events_changed: eventsChanged,
        error_message: message,
      });
    } catch {
      // Preserve the original unexpected error if closing the run also fails.
    }
    throw error;
  }
}
