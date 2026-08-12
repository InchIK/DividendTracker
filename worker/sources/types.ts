/**
 * Source fetch error with optional HTTP status.
 */
export class SourceFetchError extends Error {
  httpStatus?: number | undefined;

  constructor(message: string, httpStatus?: number) {
    super(message);
    this.name = 'SourceFetchError';
    this.httpStatus = httpStatus;
  }
}

export type { SourceObservation } from '../domain/reconciliation';