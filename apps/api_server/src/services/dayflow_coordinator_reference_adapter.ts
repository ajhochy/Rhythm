import {
  parseDayflowWorkstreamReferenceV1,
  type DayflowWorkstreamReferenceV1,
} from '../contracts/dayflow_workstream_reference_contract';
import type {
  CoordinatorContextRead,
  CoordinatorConversationContextScope,
  CoordinatorDayflowDependencyManifest,
  CoordinatorManualActivityReference,
} from '../contracts/coordinator_conversation_contract';

/**
 * Server-only hand-off owned by the Dayflow producer. The management service
 * and metadata ledger are not this reader: they cannot attest the current
 * owner/project/consent/configuration/source namespace. A missing reader is
 * therefore inactive, not an authoritative empty source.
 */
export interface DayflowCoordinatorReferenceReader {
  read(input: {
    ownerUserId: number;
    projectId: string;
    now: Date;
  }): Promise<DayflowCoordinatorReferenceRead>;
}

/**
 * The producer's current authority binding. The consumer does not assign a
 * literal namespace (the shipped producer uses a configured UUID) and does
 * not infer configuration/consent state from an envelope supplied by a reader.
 */
export interface DayflowCoordinatorAuthorityBinding {
  current(input: {
    ownerUserId: number;
    projectId: string;
    now: Date;
  }): Promise<DayflowCoordinatorAuthorityBindingRead>;
}

export type DayflowCoordinatorAuthorityBindingRead =
  | { kind: 'not_configured' }
  | { kind: 'unavailable'; reason: 'authorization_unavailable' | 'source_unavailable' | 'dependency_unqualified' }
  | {
    kind: 'available';
    ownerUserId: number;
    projectId: string;
    namespace: string;
    sourceInstance: string;
    sourceVersion: string;
    sourceRevision: string;
    sourceHash: string;
    expiresAt: string;
    consentGeneration: string;
    configurationGeneration: string;
  };

/** A bounded import-cadence signal. It stores no observation/title/URL/body. */
export interface DayflowCoordinatorSourceChangeSignal {
  kind: 'source_changed';
  ownerUserId: number;
  projectId: string;
  namespace: string;
  sourceInstance: string;
  consentGeneration: string;
  configurationGeneration: string;
  sourceVersion: string;
  sourceRevision: string;
  sourceHash: string;
  observedAt: string;
  code: 'incremental' | 'retracted' | 'consent_revoked' | 'configuration_changed' | 'source_unavailable';
}

export type DayflowCoordinatorReferenceRead =
  | { kind: 'not_configured' }
  | { kind: 'unavailable'; reason: 'authorization_unavailable' | 'source_unavailable' | 'dependency_unqualified' }
  | {
    kind: 'available';
    /** A complete current owner/project scan, never a partial change page. */
    complete: true;
    authoritative: true;
    observedAt: string;
    sourceVersion: string;
    namespace: string;
    sourceInstance: string;
    sourceRevision: string;
    sourceHash: string;
    expiresAt: string;
    ownerUserId: number;
    projectId: string;
    consentGeneration: string;
    configurationGeneration: string;
    references: unknown[];
  };

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_SIGNALS = 100;

type AvailableRead = Extract<DayflowCoordinatorReferenceRead, { kind: 'available' }>;

function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function isIso(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && SAFE_IDENTIFIER.test(value);
}

function unavailable(
  reason: 'authorization_unavailable' | 'source_unavailable' | 'dependency_unqualified',
): CoordinatorContextRead<CoordinatorManualActivityReference> {
  return { availability: 'unavailable', reason, complete: false, authoritative: false, items: [] };
}

function inactive(): CoordinatorContextRead<CoordinatorManualActivityReference> {
  return { availability: 'not_configured', reason: 'not_configured', complete: false, authoritative: false, items: [] };
}

function readKey(ownerUserId: number, projectId: string): string {
  return `${ownerUserId}:${projectId}`;
}

function parseSignal(value: unknown): DayflowCoordinatorSourceChangeSignal | null {
  if (!plain(value) || !exactKeys(value, [
    'kind', 'ownerUserId', 'projectId', 'namespace', 'sourceInstance', 'consentGeneration',
    'configurationGeneration', 'sourceVersion', 'sourceRevision', 'sourceHash', 'observedAt', 'code',
  ])) return null;
  if (
    value.kind !== 'source_changed' || !Number.isSafeInteger(value.ownerUserId) || (value.ownerUserId as number) < 1 ||
    !isIdentifier(value.projectId) || !isIdentifier(value.namespace) || !isIdentifier(value.sourceInstance) ||
    !isIdentifier(value.consentGeneration) || !isIdentifier(value.configurationGeneration) ||
    !isIdentifier(value.sourceVersion) || !isIdentifier(value.sourceRevision) ||
    typeof value.sourceHash !== 'string' || !SHA256.test(value.sourceHash) ||
    !isIso(value.observedAt) ||
    !['incremental', 'retracted', 'consent_revoked', 'configuration_changed', 'source_unavailable'].includes(value.code as string)
  ) return null;
  return value as unknown as DayflowCoordinatorSourceChangeSignal;
}

type AvailableBinding = Extract<DayflowCoordinatorAuthorityBindingRead, { kind: 'available' }>;

function parseBinding(value: unknown, scope: CoordinatorConversationContextScope): AvailableBinding | null {
  if (!plain(value) || !exactKeys(value, [
    'kind', 'ownerUserId', 'projectId', 'namespace', 'sourceInstance', 'sourceVersion', 'sourceRevision',
    'sourceHash', 'expiresAt', 'consentGeneration', 'configurationGeneration',
  ])) return null;
  if (
    value.kind !== 'available' || value.ownerUserId !== scope.ownerUserId || value.projectId !== scope.projectId ||
    !isIdentifier(value.namespace) || !isIdentifier(value.sourceInstance) || !isIdentifier(value.sourceVersion) ||
    !isIdentifier(value.sourceRevision) || typeof value.sourceHash !== 'string' || !SHA256.test(value.sourceHash) ||
    !isIso(value.expiresAt) || Date.parse(value.expiresAt) <= scope.now.valueOf() ||
    !isIdentifier(value.consentGeneration) || !isIdentifier(value.configurationGeneration)
  ) return null;
  return value as unknown as AvailableBinding;
}

function parseAvailable(
  value: unknown,
  scope: CoordinatorConversationContextScope,
  binding: AvailableBinding,
): AvailableRead | null {
  if (!plain(value) || !exactKeys(value, [
    'kind', 'complete', 'authoritative', 'observedAt', 'sourceVersion', 'namespace', 'sourceInstance',
    'sourceRevision', 'sourceHash', 'expiresAt', 'ownerUserId', 'projectId', 'consentGeneration',
    'configurationGeneration', 'references',
  ])) return null;
  if (
    value.kind !== 'available' || value.complete !== true || value.authoritative !== true ||
    value.ownerUserId !== scope.ownerUserId || value.projectId !== scope.projectId ||
    !isIso(value.observedAt) || !isIdentifier(value.sourceVersion) ||
    !isIdentifier(value.namespace) || !isIdentifier(value.sourceInstance) || !isIdentifier(value.sourceRevision) ||
    typeof value.sourceHash !== 'string' || !SHA256.test(value.sourceHash) || !isIso(value.expiresAt) ||
    Date.parse(value.expiresAt) <= scope.now.valueOf() || !isIdentifier(value.consentGeneration) ||
    !isIdentifier(value.configurationGeneration) || !Array.isArray(value.references) || value.references.length > 25
  ) return null;
  if (
    value.namespace !== binding.namespace || value.sourceInstance !== binding.sourceInstance ||
    value.sourceVersion !== binding.sourceVersion || value.sourceRevision !== binding.sourceRevision ||
    value.sourceHash !== binding.sourceHash || value.expiresAt !== binding.expiresAt ||
    value.consentGeneration !== binding.consentGeneration ||
    value.configurationGeneration !== binding.configurationGeneration
  ) return null;
  return value as unknown as AvailableRead;
}

function signalMatches(signal: DayflowCoordinatorSourceChangeSignal, current: AvailableRead): boolean {
  return signal.projectId === current.projectId && signal.ownerUserId === current.ownerUserId &&
    signal.namespace === current.namespace && signal.sourceInstance === current.sourceInstance &&
    signal.consentGeneration === current.consentGeneration &&
    signal.configurationGeneration === current.configurationGeneration &&
    signal.sourceVersion === current.sourceVersion && signal.sourceRevision === current.sourceRevision &&
    signal.sourceHash === current.sourceHash;
}

function activeOpaqueReferences(
  references: unknown[],
  input: AvailableRead,
  scope: CoordinatorConversationContextScope,
): { items: CoordinatorManualActivityReference[]; manifest: CoordinatorDayflowDependencyManifest } | null {
  const identities = new Map<string, DayflowWorkstreamReferenceV1>();
  for (const raw of references) {
    let reference: DayflowWorkstreamReferenceV1;
    try {
      reference = parseDayflowWorkstreamReferenceV1(raw);
    } catch {
      return null;
    }
    if (
      reference.ownerUserId !== scope.ownerUserId || reference.projectId !== scope.projectId ||
      reference.namespace !== input.namespace || reference.sourceInstance !== input.sourceInstance ||
      reference.consentGeneration !== input.consentGeneration ||
      reference.configurationGeneration !== input.configurationGeneration
    ) return null;
    // Canonical identity is a full-row identity. Duplicate rows, even if their
    // bytes happen to match, make completeness ambiguous and fail closed.
    if (identities.has(reference.canonicalId)) return null;
    identities.set(reference.canonicalId, reference);
  }
  const active = [...identities.values()]
    .filter((reference) => reference.eligibility === 'active' && Date.parse(reference.expiresAt) > scope.now.valueOf())
    .sort((left, right) => left.canonicalId.localeCompare(right.canonicalId));
  const manifest: CoordinatorDayflowDependencyManifest = {
    schemaVersion: 1,
    namespace: input.namespace,
    sourceInstance: input.sourceInstance,
    consentGeneration: input.consentGeneration,
    configurationGeneration: input.configurationGeneration,
    sourceVersion: input.sourceVersion,
    sourceRevision: input.sourceRevision,
    sourceHash: input.sourceHash,
    expiresAt: input.expiresAt,
    observedAt: input.observedAt,
    references: active.map((reference) => ({
      canonicalId: reference.canonicalId,
      canonicalVersion: reference.canonicalVersion,
      sourceRevision: reference.sourceRevision,
      sourceHash: reference.sourceHash,
      expiresAt: reference.expiresAt,
    })),
  };
  return {
    manifest,
    items: active.map((reference) => ({
      sourceId: reference.canonicalId,
      expectedVersion: reference.canonicalVersion,
      observedAt: reference.observedEnd,
      state: 'active' as const,
      namespace: reference.namespace,
      sourceInstance: reference.sourceInstance,
      sourceRevision: reference.sourceRevision,
      sourceHash: reference.sourceHash,
      canonicalId: reference.canonicalId,
      canonicalVersion: reference.canonicalVersion,
      consentGeneration: reference.consentGeneration,
      configurationGeneration: reference.configurationGeneration,
      expiresAt: reference.expiresAt,
      eligibility: 'active' as const,
    })),
  };
}

/**
 * Read-only coordinator-side consumer. It never imports, persists a cursor,
 * reads raw capture content, or triggers inference. `noteSourceChange` is a
 * status-only import-cadence hook: the next explicit status/admission read
 * must observe a matching fresh qualified envelope before it can rely on it.
 */
export class DayflowCoordinatorReferenceAdapter {
  private readonly changes = new Map<string, DayflowCoordinatorSourceChangeSignal>();

  constructor(
    private readonly reader?: DayflowCoordinatorReferenceReader,
    private readonly binding?: DayflowCoordinatorAuthorityBinding,
  ) {}

  noteSourceChange(signal: unknown): boolean {
    const parsed = parseSignal(signal);
    if (!parsed) return false;
    const key = readKey(parsed.ownerUserId, parsed.projectId);
    this.changes.set(key, parsed);
    while (this.changes.size > MAX_SIGNALS) this.changes.delete(this.changes.keys().next().value!);
    return true;
  }

  async read(scope: CoordinatorConversationContextScope): Promise<CoordinatorContextRead<CoordinatorManualActivityReference>> {
    if (!this.reader) return inactive();
    if (!this.binding) return unavailable('dependency_unqualified');
    let rawBinding: unknown;
    try {
      rawBinding = await this.binding.current({ ownerUserId: scope.ownerUserId, projectId: scope.projectId, now: scope.now });
    } catch {
      return unavailable('source_unavailable');
    }
    if (!plain(rawBinding) || typeof rawBinding.kind !== 'string') return unavailable('dependency_unqualified');
    if (rawBinding.kind === 'not_configured') {
      return exactKeys(rawBinding, ['kind']) ? inactive() : unavailable('dependency_unqualified');
    }
    if (rawBinding.kind === 'unavailable') {
      return exactKeys(rawBinding, ['kind', 'reason']) &&
        (rawBinding.reason === 'authorization_unavailable' || rawBinding.reason === 'source_unavailable' || rawBinding.reason === 'dependency_unqualified')
        ? unavailable(rawBinding.reason)
        : unavailable('dependency_unqualified');
    }
    const binding = parseBinding(rawBinding, scope);
    if (!binding) return unavailable('dependency_unqualified');
    let raw: unknown;
    try {
      raw = await this.reader.read({ ownerUserId: scope.ownerUserId, projectId: scope.projectId, now: scope.now });
    } catch {
      return unavailable('source_unavailable');
    }
    if (!plain(raw) || typeof raw.kind !== 'string') return unavailable('dependency_unqualified');
    if (raw.kind === 'not_configured') {
      return exactKeys(raw, ['kind']) ? inactive() : unavailable('dependency_unqualified');
    }
    if (raw.kind === 'unavailable') {
      return exactKeys(raw, ['kind', 'reason']) &&
        (raw.reason === 'authorization_unavailable' || raw.reason === 'source_unavailable' || raw.reason === 'dependency_unqualified')
        ? unavailable(raw.reason)
        : unavailable('dependency_unqualified');
    }
    const current = parseAvailable(raw, scope, binding);
    if (!current) return unavailable('dependency_unqualified');
    const signal = this.changes.get(readKey(scope.ownerUserId, scope.projectId));
    if (signal && !signalMatches(signal, current)) return unavailable('dependency_unqualified');
    const active = activeOpaqueReferences(current.references, current, scope);
    if (!active) return unavailable('dependency_unqualified');
    return {
      availability: 'available',
      reason: null,
      complete: true,
      authoritative: true,
      observedAt: current.observedAt,
      sourceVersion: current.sourceVersion,
      dependencyManifest: active.manifest,
      items: active.items,
    };
  }
}
