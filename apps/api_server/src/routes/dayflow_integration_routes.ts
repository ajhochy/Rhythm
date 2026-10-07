import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { json, Router, type NextFunction, type Request, type Response } from 'express';

import {
  DAYFLOW_ERROR_CATALOG,
  isDayflowErrorCode,
  type CommitRequest,
  type ConfigPatch,
  type DayflowErrorCode,
  type DayflowManagementService,
  type ForgetRequest,
  type PreviewRequest,
} from '../integrations/dayflow/public_contract';
import { isAllowedLocalAgentSurfaceRequest } from '../middleware/local_agent_surface_guard';

type Recovery = (typeof DAYFLOW_ERROR_CATALOG)[DayflowErrorCode]['recovery'];

const statusFor: Record<DayflowErrorCode, number> = {
  INVALID_REQUEST: 400, CURSOR_INVALID: 400,
  LOCAL_ONLY: 403, FORBIDDEN_ORIGIN: 403,
  OWNED_NOTE_NOT_FOUND: 404,
  SOURCE_MISSING: 409, SOURCE_UNSUPPORTED: 409, SOURCE_UNVERIFIED: 409, SOURCE_CHANGED: 409,
  DISABLED: 409, TIMEZONE_REQUIRED: 409, PREVIEW_EXPIRED: 409, PREVIEW_INVALIDATED: 409,
  SELECTION_CONFLICT: 409, PENDING_OPERATION: 409, CURSOR_STALE: 409, READER_CANCELLED: 409,
  READER_FAILED: 422, EXPORT_INVALID: 422, EXPORT_LIMIT: 422, TIMEZONE_MISMATCH: 422,
  READER_TIMEOUT: 504,
  IMPORT_UNCERTAIN: 503, LEDGER_UNAVAILABLE: 503, INTERNAL_ERROR: 503,
};

class DayflowRouteError extends Error {
  constructor(readonly code: DayflowErrorCode) { super(code); }
}

function isLoopback(request: Request): boolean {
  const address = request.socket.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function fail(code: DayflowErrorCode): never { throw new DayflowRouteError(code); }

function plainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_REQUEST');
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail('INVALID_REQUEST');
}

function strictDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('INVALID_REQUEST');
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) fail('INVALID_REQUEST');
  return value;
}

function boundedString(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) fail('INVALID_REQUEST');
  return value;
}

function configPatch(value: unknown): ConfigPatch {
  const body = plainObject(value);
  onlyKeys(body, ['enabled', 'automaticImport', 'timezone', 'exclusions', 'maxRecordsPerRun', 'sourceSelectionToken']);
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') fail('INVALID_REQUEST');
  if (body.automaticImport !== undefined && typeof body.automaticImport !== 'boolean') fail('INVALID_REQUEST');
  if (body.timezone !== undefined && (typeof body.timezone !== 'string' || body.timezone.length === 0 || body.timezone.length > 128)) fail('INVALID_REQUEST');
  if (body.exclusions !== undefined && (!Array.isArray(body.exclusions) || body.exclusions.some((item) => typeof item !== 'string' || item.length > 256))) fail('INVALID_REQUEST');
  if (body.maxRecordsPerRun !== undefined && (!Number.isInteger(body.maxRecordsPerRun) || Number(body.maxRecordsPerRun) < 1 || Number(body.maxRecordsPerRun) > 1_000)) fail('INVALID_REQUEST');
  if (body.sourceSelectionToken !== undefined && (typeof body.sourceSelectionToken !== 'string' || body.sourceSelectionToken.length === 0 || body.sourceSelectionToken.length > 512)) fail('INVALID_REQUEST');
  if (body.sourceSelectionToken !== undefined && (body.enabled === true || body.automaticImport === true)) fail('INVALID_REQUEST');
  return body as ConfigPatch;
}

function commitRequest(value: unknown): CommitRequest {
  const body = plainObject(value);
  onlyKeys(body, ['token', 'candidateIds']);
  const token = boundedString(body.token, 512);
  if (!Array.isArray(body.candidateIds) || body.candidateIds.length > 10_000 || body.candidateIds.some((id) => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) fail('INVALID_REQUEST');
  return { token, candidateIds: body.candidateIds };
}

function forgetRequest(value: unknown): ForgetRequest {
  const body = plainObject(value);
  onlyKeys(body, ['memoryId']);
  const memoryId = boundedString(body.memoryId, 26);
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(memoryId)) fail('INVALID_REQUEST');
  return { memoryId };
}

function ownedNotesInput(query: Request['query']): { limit: number; cursor?: string } {
  if (Object.keys(query).some((key) => key !== 'limit' && key !== 'cursor')) fail('INVALID_REQUEST');
  const rawLimit = query.limit;
  const rawCursor = query.cursor;
  if (Array.isArray(rawLimit) || Array.isArray(rawCursor)) fail('CURSOR_INVALID');
  const limit = rawLimit === undefined ? 25 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('CURSOR_INVALID');
  if (rawCursor !== undefined && (typeof rawCursor !== 'string' || rawCursor.length === 0 || rawCursor.length > 256)) fail('CURSOR_INVALID');
  return rawCursor === undefined ? { limit } : { limit, cursor: rawCursor };
}

function publicError(error: unknown): DayflowErrorCode {
  if (error instanceof DayflowRouteError) return error.code;
  if (typeof error === 'object' && error !== null && 'code' in error && isDayflowErrorCode(error.code)) return error.code;
  if (typeof error === 'object' && error !== null && 'status' in error && (error.status === 400 || error.status === 413)) return 'INVALID_REQUEST';
  if (error instanceof Error && isDayflowErrorCode(error.message)) return error.message;
  return 'INTERNAL_ERROR';
}

function sendError(response: Response, code: DayflowErrorCode): void {
  const catalog = DAYFLOW_ERROR_CATALOG[code];
  response.status(statusFor[code]).json({
    error: { code, message: catalog.message, retryable: catalog.retryable, recovery: catalog.recovery as Recovery, requestId: randomUUID() },
  });
}

function handler(fn: (request: Request, service: DayflowManagementService) => unknown | Promise<unknown>, service: DayflowManagementService) {
  return async (request: Request, response: Response) => {
    try { response.json(await fn(request, service)); }
    catch (error) { sendError(response, publicError(error)); }
  };
}

/**
 * Local-only Dayflow management boundary. It validates and serializes only
 * public DTOs; all source, ledger, and canonical-memory work stays in the
 * implementation supplied by the Dayflow owner.
 */
export function createDayflowIntegrationRouter(service: DayflowManagementService) {
  const router = Router();
  router.use((request, response, next) => {
    if (isLoopback(request) && isAllowedLocalAgentSurfaceRequest(request.headers)) { next(); return; }
    sendError(response, isLoopback(request) ? 'FORBIDDEN_ORIGIN' : 'LOCAL_ONLY');
  });
  // Mounted ahead of the app-wide parser so this boundary retains its raw
  // 16 KiB limit without changing parsing behavior for any other route.
  router.use(json({ limit: '16kb', strict: true }));

  router.get('/status', handler((_request, api) => api.status(), service));
  router.get('/readiness', handler((_request, api) => api.readiness(), service));
  router.post('/readiness/check', handler((request, api) => {
    const body = plainObject(request.body); onlyKeys(body, ['bundlePath']);
    const bundlePath = boundedString(body.bundlePath, 4096);
    if (!isAbsolute(bundlePath)) fail('INVALID_REQUEST');
    return api.checkReadiness({ bundlePath });
  }, service));
  router.get('/config', handler((_request, api) => api.getConfig(), service));
  router.put('/config', handler((request, api) => api.updateConfig(configPatch(request.body)), service));
  router.post('/preview', handler((request, api) => {
    const body = plainObject(request.body); onlyKeys(body, ['date']);
    const preview: PreviewRequest = { date: strictDate(body.date) };
    return api.preview(preview);
  }, service));
  router.post('/commit', handler((request, api) => api.commit(commitRequest(request.body)), service));
  router.get('/owned-notes', handler((request, api) => api.listOwnedNotes(ownedNotesInput(request.query)), service));
  router.post('/forget', handler((request, api) => api.forget(forgetRequest(request.body)), service));
  router.post('/disable', handler((request, api) => {
    const body = plainObject(request.body ?? {}); onlyKeys(body, []);
    return api.disable();
  }, service));
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => sendError(response, publicError(error)));
  return router;
}

export const dayflowRouteTesting = { commitRequest, configPatch, forgetRequest, ownedNotesInput, strictDate };
