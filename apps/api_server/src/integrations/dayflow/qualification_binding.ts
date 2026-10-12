import { createHash } from 'node:crypto';

import type { DayflowConfig, DayflowSourceConsent } from './types';

/**
 * Server-only binding shared by the producer and the persisted qualification
 * authority. It derives from the selected journal metadata, never from a
 * caller path, session, SDK id, or reader request.
 */
export interface DayflowQualificationBinding {
  namespace: string;
  sourceInstance: string;
  configurationGeneration: string;
}

export function opaqueDayflowReaderId(prefix: string, value: unknown): string {
  return `${prefix}:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

export function deriveDayflowQualificationBinding(
  config: DayflowConfig,
): DayflowQualificationBinding | null {
  if (!config.enabled || !config.automaticImport || !config.timezone ||
      !config.journalPath || !config.journalBinding) return null;
  const sourceInstance = opaqueDayflowReaderId('source', [
    config.sourceNamespace,
    config.journalBinding.fileIdentity,
    config.journalBinding.schemaFingerprint,
  ]);
  const configurationGeneration = opaqueDayflowReaderId('config', [
    config.sourceNamespace,
    config.qualificationGeneration,
    sourceInstance,
    config.timezone,
    [...config.exclusions].sort(),
    config.maxRecordsPerRun,
  ]);
  return { namespace: config.sourceNamespace, sourceInstance, configurationGeneration };
}

export function activeDayflowSourceConsent(
  config: DayflowConfig,
  binding: DayflowQualificationBinding,
): DayflowSourceConsent | null {
  const consent = config.sourceConsent;
  if (!consent || consent.revokedAt !== undefined) return null;
  return consent.namespace === binding.namespace &&
    consent.sourceInstance === binding.sourceInstance &&
    consent.configurationGeneration === binding.configurationGeneration
    ? consent
    : null;
}

/** Preserve a durable revocation record instead of silently deleting it. */
export function revokeDayflowSourceConsent(
  consent: DayflowSourceConsent | null,
  at: string,
): DayflowSourceConsent | null {
  if (!consent || consent.revokedAt !== undefined) return consent;
  return { ...consent, revokedAt: at };
}
