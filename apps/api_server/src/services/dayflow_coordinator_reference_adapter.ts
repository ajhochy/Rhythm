import { createHash } from 'node:crypto';
import {
  parseDayflowWorkstreamReferenceV1,
  type DayflowWorkstreamReferenceV1,
} from '../contracts/dayflow_workstream_reference_contract';
import {
  dayflowReaderBinding,
  parseDayflowQualificationScope,
  type DayflowQualificationScope,
  type DayflowQualifiedReferencePage,
} from '../contracts/dayflow_coordinator_reader_contract';
import type {
  CoordinatorContextCoverage,
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
    /** Present only when a complete qualified scan was safely projected. */
    coverage?: CoordinatorContextCoverage;
    references: unknown[];
  };

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_SIGNALS = 100;
/** The model/context projection remains deliberately small. */
const MAX_CONTEXT_REFERENCES = 25;
/** The existing qualified reader's largest complete single-page admission. */
const MAX_QUALIFIED_REFERENCE_SCAN = 3_000;

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
  const requiredKeys = [
    'kind', 'complete', 'authoritative', 'observedAt', 'sourceVersion', 'namespace', 'sourceInstance',
    'sourceRevision', 'sourceHash', 'expiresAt', 'ownerUserId', 'projectId', 'consentGeneration',
    'configurationGeneration', 'references',
  ] as const;
  if (!plain(value) || !requiredKeys.every((key) => key in value) ||
      !Object.keys(value).every((key) => requiredKeys.includes(key as typeof requiredKeys[number]) || key === 'coverage')) return null;
  const coverage = value.coverage === undefined ? undefined : parseCoverage(value.coverage);
  if (
    value.kind !== 'available' || value.complete !== true || value.authoritative !== true ||
    value.ownerUserId !== scope.ownerUserId || value.projectId !== scope.projectId ||
    !isIso(value.observedAt) || !isIdentifier(value.sourceVersion) ||
    !isIdentifier(value.namespace) || !isIdentifier(value.sourceInstance) || !isIdentifier(value.sourceRevision) ||
    typeof value.sourceHash !== 'string' || !SHA256.test(value.sourceHash) || !isIso(value.expiresAt) ||
    Date.parse(value.expiresAt) <= scope.now.valueOf() || !isIdentifier(value.consentGeneration) ||
    !isIdentifier(value.configurationGeneration) || !Array.isArray(value.references) || value.references.length > MAX_CONTEXT_REFERENCES ||
    (value.coverage !== undefined && (!coverage || coverage.selectedItems !== value.references.length))
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

function parseCoverage(value: unknown): CoordinatorContextCoverage | null {
  if (!plain(value) || !exactKeys(value, ['strategy', 'totalItems', 'selectedItems', 'maxItems'])) return null;
  const strategy = value.strategy;
  const totalItems = value.totalItems;
  const selectedItems = value.selectedItems;
  const maxItems = value.maxItems;
  if (
    (strategy !== 'complete' && strategy !== 'bounded_relevance') ||
    typeof totalItems !== 'number' || !Number.isSafeInteger(totalItems) || totalItems < 0 || totalItems > MAX_QUALIFIED_REFERENCE_SCAN ||
    typeof selectedItems !== 'number' || !Number.isSafeInteger(selectedItems) || selectedItems < 0 ||
    typeof maxItems !== 'number' || !Number.isSafeInteger(maxItems) || maxItems !== MAX_CONTEXT_REFERENCES ||
    selectedItems > maxItems || selectedItems > totalItems
  ) return null;
  if (strategy === 'complete' && selectedItems !== totalItems) return null;
  if (strategy === 'bounded_relevance' && totalItems <= selectedItems) return null;
  return value as unknown as CoordinatorContextCoverage;
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
): {
  items: CoordinatorManualActivityReference[];
  manifest: CoordinatorDayflowDependencyManifest;
  coverage?: CoordinatorContextCoverage;
} | null {
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
  // A producer-provided bounded projection may not silently lose a selected
  // reference while this consumer revalidates its authority/expiry fields.
  if (input.coverage && active.length !== input.coverage.selectedItems) return null;
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
    ...(input.coverage ? { coverage: input.coverage } : {}),
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
 * The qualified Dayflow producer exposes only its metadata-only reference
 * page.  It is deliberately narrower than the receiving/evidence reader, so
 * this optional context projection cannot read a canonical note or reuse a
 * signed tool admission.
 */
export interface DayflowCoordinatorQualifiedReferenceReader {
  readQualifiedReferences(input: {
    ownerUserId: number;
    projectId: string;
    limit?: number;
    cursor?: string;
  }): Promise<DayflowQualifiedReferencePage>;
}

/** The persisted source-consent authority is the only scope origin. */
export interface DayflowCoordinatorPersistedAuthority {
  activeScope(): {
    binding: {
      namespace: string;
      sourceInstance: string;
      configurationGeneration: string;
    };
    scope: DayflowQualificationScope;
  } | null;
}

export interface DayflowCoordinatorReferenceProducerPorts {
  reader: () => DayflowCoordinatorQualifiedReferenceReader | undefined;
  authority: () => DayflowCoordinatorPersistedAuthority | undefined;
}

type CoordinatorPortUnavailableReason = Extract<DayflowCoordinatorReferenceRead, { kind: 'unavailable' }>['reason'];

function unavailablePort(reason: CoordinatorPortUnavailableReason): DayflowCoordinatorReferenceRead {
  return { kind: 'unavailable', reason };
}

function sameQualificationScope(left: DayflowQualificationScope, right: DayflowQualificationScope): boolean {
  return left.ownerUserId === right.ownerUserId && left.projectId === right.projectId &&
    left.namespace === right.namespace && left.sourceInstance === right.sourceInstance &&
    left.consentGeneration === right.consentGeneration &&
    left.configurationGeneration === right.configurationGeneration;
}

function currentScope(value: unknown): {
  binding: { namespace: string; sourceInstance: string; configurationGeneration: string };
  scope: DayflowQualificationScope;
} | null {
  if (!plain(value) || !plain(value.binding) || !('scope' in value)) return null;
  const binding = value.binding;
  if (
    !exactKeys(binding, ['namespace', 'sourceInstance', 'configurationGeneration']) ||
    !isIdentifier(binding.namespace) || !isIdentifier(binding.sourceInstance) ||
    !isIdentifier(binding.configurationGeneration)
  ) return null;
  try {
    const scope = parseDayflowQualificationScope(value.scope);
    if (
      scope.namespace !== binding.namespace ||
      scope.sourceInstance !== binding.sourceInstance ||
      scope.configurationGeneration !== binding.configurationGeneration
    ) return null;
    return {
      binding: {
        namespace: binding.namespace,
        sourceInstance: binding.sourceInstance,
        configurationGeneration: binding.configurationGeneration,
      },
      scope,
    };
  } catch {
    return null;
  }
}

function sameCurrentScope(
  left: NonNullable<ReturnType<typeof currentScope>>,
  right: NonNullable<ReturnType<typeof currentScope>>,
): boolean {
  return sameQualificationScope(left.scope, right.scope) &&
    left.binding.namespace === right.binding.namespace &&
    left.binding.sourceInstance === right.binding.sourceInstance &&
    left.binding.configurationGeneration === right.binding.configurationGeneration;
}

function qualifiedReferencePage(value: unknown): DayflowQualifiedReferencePage | null {
  if (!plain(value) || !exactKeys(value, ['schemaVersion', 'status', 'references', 'nextCursor'])) return null;
  if (value.schemaVersion !== 1 || !['available', 'not_configured', 'unavailable'].includes(value.status as string) ||
      !Array.isArray(value.references) || (value.nextCursor !== null && !isIdentifier(value.nextCursor))) return null;
  if (value.status !== 'available' && (value.references.length !== 0 || value.nextCursor !== null)) return null;
  return value as unknown as DayflowQualifiedReferencePage;
}

function coordinatorEnvelope(
  page: DayflowQualifiedReferencePage,
  active: NonNullable<ReturnType<typeof currentScope>>,
  scope: CoordinatorConversationContextScope,
): DayflowCoordinatorReferenceRead {
  if (page.status === 'not_configured') return unavailablePort('dependency_unqualified');
  if (page.status === 'unavailable') return unavailablePort('source_unavailable');
  // The coordinator has no cursor state. It may read the existing reader's
  // complete bounded admission exactly once, never an arbitrary first page.
  if (page.nextCursor !== null || page.references.length === 0 || page.references.length > MAX_QUALIFIED_REFERENCE_SCAN) {
    return unavailablePort('dependency_unqualified');
  }
  const references: DayflowWorkstreamReferenceV1[] = [];
  const identities = new Set<string>();
  for (const raw of page.references) {
    let reference: DayflowWorkstreamReferenceV1;
    try {
      reference = parseDayflowWorkstreamReferenceV1(raw);
    } catch {
      return unavailablePort('dependency_unqualified');
    }
    if (
      reference.ownerUserId !== scope.ownerUserId || reference.projectId !== scope.projectId ||
      reference.namespace !== active.scope.namespace || reference.sourceInstance !== active.scope.sourceInstance ||
      reference.consentGeneration !== active.scope.consentGeneration ||
      reference.configurationGeneration !== active.scope.configurationGeneration ||
      reference.eligibility !== 'active' || Date.parse(reference.expiresAt) <= scope.now.valueOf() ||
      identities.has(reference.canonicalId)
    ) return unavailablePort('dependency_unqualified');
    identities.add(reference.canonicalId);
    references.push(reference);
  }
  const sourceVersion = references[0].exporterVersion;
  const normalizerVersion = references[0].normalizerVersion;
  if (references.some((reference) =>
    reference.exporterVersion !== sourceVersion || reference.normalizerVersion !== normalizerVersion,
  )) return unavailablePort('dependency_unqualified');
  const orderedReferences = [...references].sort((left, right) =>
    left.canonicalId.localeCompare(right.canonicalId) ||
    left.canonicalVersion.localeCompare(right.canonicalVersion) ||
    left.sourceRevision.localeCompare(right.sourceRevision) ||
    left.sourceHash.localeCompare(right.sourceHash),
  );
  const canonicalReferences = orderedReferences.map((reference) => ({
    schemaVersion: reference.schemaVersion,
    namespace: reference.namespace,
    sourceInstance: reference.sourceInstance,
    sourceId: reference.sourceId,
    exporterVersion: reference.exporterVersion,
    normalizerVersion: reference.normalizerVersion,
    sourceRevision: reference.sourceRevision,
    sourceHash: reference.sourceHash,
    canonicalId: reference.canonicalId,
    canonicalVersion: reference.canonicalVersion,
    ownerUserId: reference.ownerUserId,
    projectId: reference.projectId,
    consentGeneration: reference.consentGeneration,
    configurationGeneration: reference.configurationGeneration,
    observedStart: reference.observedStart,
    observedEnd: reference.observedEnd,
    expiresAt: reference.expiresAt,
    eligibility: reference.eligibility,
    appId: reference.appId ?? null,
  }));
  // The existing qualified reader has no arbitrary source-wide revision. Its
  // bounded, complete V1 receipt set is the only safe coordinator revision.
  // This is a composite fingerprint of real receipt metadata, not a caller
  // label, raw observation, or ledger/management-status substitute.
  const fingerprint = {
    schemaVersion: 1,
    scope: {
      ownerUserId: active.scope.ownerUserId,
      projectId: active.scope.projectId,
      namespace: active.scope.namespace,
      sourceInstance: active.scope.sourceInstance,
      consentGeneration: active.scope.consentGeneration,
      configurationGeneration: active.scope.configurationGeneration,
    },
    sourceVersion,
    normalizerVersion,
    references: canonicalReferences,
  };
  const sourceHash = createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');
  const sourceRevision = `qualified:${dayflowReaderBinding(fingerprint)}`;
  const observedAt = references.reduce(
    (latest, reference) => reference.observedEnd > latest ? reference.observedEnd : latest,
    references[0].observedEnd,
  );
  const expiresAt = references.reduce(
    (earliest, reference) => reference.expiresAt < earliest ? reference.expiresAt : earliest,
    references[0].expiresAt,
  );
  // The fingerprint/expiry above describe the full current receipt set. Only
  // this deterministic relevance window reaches coordinator model context.
  const selectedReferences = orderedReferences.slice(0, MAX_CONTEXT_REFERENCES);
  const coverage: CoordinatorContextCoverage = {
    strategy: references.length === selectedReferences.length ? 'complete' : 'bounded_relevance',
    totalItems: references.length,
    selectedItems: selectedReferences.length,
    maxItems: MAX_CONTEXT_REFERENCES,
  };
  return {
    kind: 'available',
    complete: true,
    authoritative: true,
    observedAt,
    sourceVersion,
    namespace: active.scope.namespace,
    sourceInstance: active.scope.sourceInstance,
    sourceRevision,
    sourceHash,
    expiresAt,
    ownerUserId: scope.ownerUserId,
    projectId: scope.projectId,
    consentGeneration: active.scope.consentGeneration,
    configurationGeneration: active.scope.configurationGeneration,
    coverage,
    references: selectedReferences,
  };
}

async function readQualifiedCoordinatorEnvelope(
  ports: DayflowCoordinatorReferenceProducerPorts,
  input: { ownerUserId: number; projectId: string; now: Date },
): Promise<DayflowCoordinatorReferenceRead> {
  const reader = ports.reader();
  const authority = ports.authority();
  if (!reader && !authority) return { kind: 'not_configured' };
  if (!reader || !authority) return unavailablePort('dependency_unqualified');
  let before: ReturnType<typeof currentScope>;
  try {
    before = currentScope(authority.activeScope());
  } catch {
    return unavailablePort('source_unavailable');
  }
  if (!before) return { kind: 'not_configured' };
  if (before.scope.ownerUserId !== input.ownerUserId || before.scope.projectId !== input.projectId) {
    return unavailablePort('authorization_unavailable');
  }
  let rawPage: unknown;
  try {
    rawPage = await reader.readQualifiedReferences({
      ownerUserId: input.ownerUserId,
      projectId: input.projectId,
      limit: MAX_QUALIFIED_REFERENCE_SCAN,
    });
  } catch {
    return unavailablePort('source_unavailable');
  }
  // The service and authority objects themselves are part of the current
  // composition proof. Do not finish a read through a replaced dependency.
  if (ports.reader() !== reader || ports.authority() !== authority) return unavailablePort('dependency_unqualified');
  let after: ReturnType<typeof currentScope>;
  try {
    after = currentScope(authority.activeScope());
  } catch {
    return unavailablePort('source_unavailable');
  }
  if (!after || !sameCurrentScope(before, after)) return unavailablePort('authorization_unavailable');
  if (after.scope.ownerUserId !== input.ownerUserId || after.scope.projectId !== input.projectId) {
    return unavailablePort('authorization_unavailable');
  }
  const page = qualifiedReferencePage(rawPage);
  if (!page) return unavailablePort('dependency_unqualified');
  return coordinatorEnvelope(page, after, {
    ownerUserId: input.ownerUserId,
    projectId: input.projectId,
    conversationId: 'coordinator-port',
    now: input.now,
  });
}

/**
 * Compose the existing authenticated Dayflow producer into the coordinator's
 * metadata-only reader. Both calls independently take a fresh bounded source
 * snapshot; the adapter accepts a status result only when their complete
 * qualified fingerprints match. This keeps revoke/config/source changes
 * closed across the adapter's binding/read await boundary.
 */
export function createDayflowCoordinatorReferenceAdapter(
  ports: DayflowCoordinatorReferenceProducerPorts,
): DayflowCoordinatorReferenceAdapter {
  const read = (input: { ownerUserId: number; projectId: string; now: Date }) =>
    readQualifiedCoordinatorEnvelope(ports, input);
  return new DayflowCoordinatorReferenceAdapter(
    { read },
    {
      current: async (input) => {
        const snapshot = await read(input);
        if (snapshot.kind !== 'available') return snapshot;
        return {
          kind: 'available',
          ownerUserId: snapshot.ownerUserId,
          projectId: snapshot.projectId,
          namespace: snapshot.namespace,
          sourceInstance: snapshot.sourceInstance,
          sourceVersion: snapshot.sourceVersion,
          sourceRevision: snapshot.sourceRevision,
          sourceHash: snapshot.sourceHash,
          expiresAt: snapshot.expiresAt,
          consentGeneration: snapshot.consentGeneration,
          configurationGeneration: snapshot.configurationGeneration,
        };
      },
    },
  );
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
      ...(active.coverage ? { coverage: active.coverage } : {}),
      items: active.items,
    };
  }
}
