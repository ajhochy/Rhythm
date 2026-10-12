import { AppError } from '../errors/app_error';

/** Metadata-only hand-off; it intentionally has no title, URL, observation, or body field. */
export interface DayflowWorkstreamReferenceV1 {
  schemaVersion: 1;
  namespace: string;
  sourceInstance: string;
  sourceId: string;
  exporterVersion: string;
  normalizerVersion: string;
  sourceRevision: string;
  sourceHash: string;
  canonicalId: string;
  canonicalVersion: string;
  ownerUserId: number;
  projectId: string;
  consentGeneration: string;
  configurationGeneration: string;
  observedStart: string;
  observedEnd: string;
  expiresAt: string;
  eligibility: 'active' | 'pending_create' | 'pending_delete' | 'retracted';
  appId?: string;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const HASH = /^[0-9a-f]{64}$/;
const KEYS = [
  'schemaVersion', 'namespace', 'sourceInstance', 'sourceId', 'exporterVersion',
  'normalizerVersion', 'sourceRevision', 'sourceHash', 'canonicalId', 'canonicalVersion',
  'ownerUserId', 'projectId', 'consentGeneration', 'configurationGeneration',
  'observedStart', 'observedEnd', 'expiresAt', 'eligibility', 'appId',
] as const;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw AppError.badRequest('invalid Dayflow reference');
  const valueRecord = value as Record<string, unknown>;
  if (Object.keys(valueRecord).some((key) => !(KEYS as readonly string[]).includes(key))) {
    throw AppError.badRequest('invalid Dayflow reference');
  }
  return valueRecord;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) throw AppError.badRequest('invalid Dayflow reference');
  return value;
}

function iso(value: unknown): string {
  if (typeof value !== 'string') throw AppError.badRequest('invalid Dayflow reference');
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw AppError.badRequest('invalid Dayflow reference');
  }
  return value;
}

export function parseDayflowWorkstreamReferenceV1(value: unknown): DayflowWorkstreamReferenceV1 {
  const raw = record(value);
  const required = KEYS.filter((key) => key !== 'appId');
  if (required.some((key) => raw[key] === undefined) || raw.schemaVersion !== 1 ||
      !Number.isSafeInteger(raw.ownerUserId) || (raw.ownerUserId as number) <= 0 ||
      typeof raw.sourceHash !== 'string' || !HASH.test(raw.sourceHash) ||
      !['active', 'pending_create', 'pending_delete', 'retracted'].includes(raw.eligibility as string)) {
    throw AppError.badRequest('invalid Dayflow reference');
  }
  const parsed: DayflowWorkstreamReferenceV1 = {
    schemaVersion: 1,
    namespace: id(raw.namespace), sourceInstance: id(raw.sourceInstance), sourceId: id(raw.sourceId),
    exporterVersion: id(raw.exporterVersion), normalizerVersion: id(raw.normalizerVersion),
    sourceRevision: id(raw.sourceRevision), sourceHash: raw.sourceHash, canonicalId: id(raw.canonicalId),
    canonicalVersion: id(raw.canonicalVersion), ownerUserId: raw.ownerUserId as number,
    projectId: id(raw.projectId), consentGeneration: id(raw.consentGeneration),
    configurationGeneration: id(raw.configurationGeneration), observedStart: iso(raw.observedStart),
    observedEnd: iso(raw.observedEnd), expiresAt: iso(raw.expiresAt),
    eligibility: raw.eligibility as DayflowWorkstreamReferenceV1['eligibility'],
  };
  if (Date.parse(parsed.observedEnd) < Date.parse(parsed.observedStart)) throw AppError.badRequest('invalid Dayflow reference');
  if (raw.appId !== undefined) parsed.appId = id(raw.appId);
  return parsed;
}
