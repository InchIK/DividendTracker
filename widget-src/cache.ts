/**
 * Installation-scoped cache for the DividendTracker widget.
 *
 * Every personalised download gets a fresh installationId. Keeping that ID in
 * the filename prevents a newly rotated token from ever displaying data that
 * belonged to another installation.
 */

import type { UpcomingWidgetResponse } from './formatter';

const CACHE_FILENAME_PREFIX = 'dividend-tracker-widget-cache-';

export interface CacheEntry {
  cachedAt: string;
  payload: UpcomingWidgetResponse;
}

/** Keep arbitrary manual setup values inside the Scriptable documents folder. */
function sanitizeInstallationId(installationId: string): string {
  const sanitized = installationId.trim().replace(/[^A-Za-z0-9_-]/g, '_');
  return sanitized || 'unknown';
}

export function cacheFilename(installationId: string): string {
  return `${CACHE_FILENAME_PREFIX}${sanitizeInstallationId(installationId)}.json`;
}

function cachePath(installationId: string): string {
  const fm = FileManager.local();
  return fm.joinPath(fm.documentsDirectory(), cacheFilename(installationId));
}

/** Persist a fresh payload to this installation's cache file. */
export function writeCache(installationId: string, payload: UpcomingWidgetResponse): void {
  const entry: CacheEntry = {
    cachedAt: new Date().toISOString(),
    payload,
  };
  const fm = FileManager.local();
  fm.writeString(cachePath(installationId), JSON.stringify(entry));
}

/** Read only the cache associated with the supplied installation ID. */
export function readCache(installationId: string): CacheEntry | null {
  const fm = FileManager.local();
  const path = cachePath(installationId);
  if (!fm.fileExists(path)) return null;

  try {
    const raw = fm.readString(path);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object'
      || parsed === null
      || typeof (parsed as { cachedAt?: unknown }).cachedAt !== 'string'
      || typeof (parsed as { payload?: unknown }).payload !== 'object'
      || (parsed as { payload?: unknown }).payload === null
    ) {
      return null;
    }
    return parsed as CacheEntry;
  } catch {
    return null;
  }
}

/** Remove only this installation's cache file. */
export function clearCache(installationId: string): void {
  const fm = FileManager.local();
  const path = cachePath(installationId);
  if (fm.fileExists(path)) fm.remove(path);
}

/** Seconds since this installation's cache was written. */
export function cacheAgeSeconds(installationId: string): number {
  const entry = readCache(installationId);
  if (!entry) return Number.POSITIVE_INFINITY;
  const then = Date.parse(entry.cachedAt);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (Date.now() - then) / 1000;
}
