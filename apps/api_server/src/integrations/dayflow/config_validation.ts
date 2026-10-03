import { randomUUID } from 'node:crypto';
import { DEFAULT_DAYFLOW_CONFIG, type DayflowConfig } from './types';

const configKeys = new Set(['schemaVersion', 'enabled', 'automaticImport', 'journalPath', 'journalBinding', 'executablePath', 'sourceVersion', 'sourceNamespace', 'timezone', 'rolloverHour', 'exclusions', 'retentionDays', 'maxRecordsPerRun']);
const validNamespace = /^[a-f0-9-]{36}$/i;

/** Strict, fail-closed validation shared by requests and persisted configuration. */
export function validateDayflowConfig(input: unknown, allowMissing = false): DayflowConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Dayflow configuration is malformed.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !configKeys.has(key))) throw new Error('Dayflow configuration contains an unsupported field.');
  const merged = allowMissing ? { ...DEFAULT_DAYFLOW_CONFIG, ...value } : value;
  if (merged.schemaVersion !== 1 || typeof merged.enabled !== 'boolean' || typeof merged.automaticImport !== 'boolean' || merged.rolloverHour !== 4) throw new Error('Dayflow configuration has unsafe fixed fields.');
  if (merged.journalPath !== null && (typeof merged.journalPath !== 'string' || !merged.journalPath.startsWith('/') || merged.journalPath.length > 4096)) throw new Error('Dayflow journal selection is invalid.');
  if (merged.journalBinding !== null && (
    !merged.journalBinding || typeof merged.journalBinding !== 'object' || Array.isArray(merged.journalBinding) ||
    Object.keys(merged.journalBinding as Record<string, unknown>).some((key) => key !== 'fileIdentity' && key !== 'schemaFingerprint') ||
    typeof (merged.journalBinding as Record<string, unknown>).fileIdentity !== 'string' || !/^\d+:\d+$/.test((merged.journalBinding as Record<string, string>).fileIdentity) ||
    typeof (merged.journalBinding as Record<string, unknown>).schemaFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test((merged.journalBinding as Record<string, string>).schemaFingerprint)
  )) throw new Error('Dayflow journal attestation is invalid.');
  if (merged.journalPath === null && merged.journalBinding !== null) throw new Error('Dayflow journal attestation has no selection.');
  if (merged.executablePath !== null || merged.sourceVersion !== null) throw new Error('Dayflow live source configuration is unavailable until qualification.');
  if (typeof merged.sourceNamespace !== 'string' || !validNamespace.test(merged.sourceNamespace)) throw new Error('Dayflow source namespace is invalid.');
  if (merged.timezone !== null && (typeof merged.timezone !== 'string' || !isTimezone(merged.timezone))) throw new Error('Dayflow timezone is invalid.');
  if (!Array.isArray(merged.exclusions) || merged.exclusions.some((item) => typeof item !== 'string' || !/^category:[A-Za-z0-9 _-]{1,80}$/.test(item))) throw new Error('Dayflow exclusions must be supported category rules.');
  if (merged.retentionDays !== null || !Number.isInteger(merged.maxRecordsPerRun) || (merged.maxRecordsPerRun as number) < 1 || (merged.maxRecordsPerRun as number) > 1000) throw new Error('Dayflow configuration has unsafe lifecycle limits.');
  return structuredClone(merged as unknown as DayflowConfig);
}

export function freshDayflowConfig(): DayflowConfig { return validateDayflowConfig({ ...DEFAULT_DAYFLOW_CONFIG, sourceNamespace: randomUUID() }, false); }
export function isTimezone(value: string) { try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; } }
