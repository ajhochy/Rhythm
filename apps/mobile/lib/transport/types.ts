/**
 * Shared transport types used by both RhythmCloudClient and PairedMacClient.
 */

/** Which backend generated this error. */
export type ApiErrorSource = 'cloud' | 'paired-mac';

/** Normalized API error. Both clients throw only this type. */
export interface ApiErrorOptions {
  /** Which backend generated this error. */
  source: ApiErrorSource;
  /** HTTP status code (0 for network-level failures). */
  status: number;
  /** Machine-readable error code from the response body, or a generic fallback. */
  code: string;
  /** Human-readable description safe to display; never contains auth tokens. */
  message: string;
  /** Whether the caller may retry the same request automatically. */
  retryable: boolean;
}

/** Options accepted by `RhythmCloudClient`. */
export interface RhythmCloudClientOptions {
  /** Production Rhythm API base URL, e.g. `https://api.rhythmapp.dev`. */
  baseUrl: string;
  /**
   * Async provider for the current Rhythm Cloud bearer token.
   * The value returned here is placed in `Authorization: Bearer <token>`.
   * It must never be included in error objects.
   */
  getToken: () => Promise<string>;
}

/** Options accepted by `PairedMacClient`. */
export interface PairedMacClientOptions {
  /** Preferred HTTP base URL. May be the path-bearing Synology relay URL. */
  baseUrl: string;
  /** Direct Tailscale origin used for transports the relay does not support. */
  directBaseUrl?: string;
  /**
   * Async provider for the current device token.
   * The value returned here is placed in `Authorization: Device <token>`.
   * It must never be included in error objects.
   */
  getDeviceToken: () => Promise<string>;
}

/** Slim fetch override accepted as the last argument to `.request()`.
 *  Callers and tests may inject a custom fetch; production code uses
 *  the global `fetch`. */
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;
