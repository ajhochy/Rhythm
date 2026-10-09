export const MANAGED_CONTEXT_SCHEMA_VERSION = 1 as const;
export const MANAGED_CONTEXT_MAX_REFERENCES = 128;
export const MANAGED_CONTEXT_MAX_IDENTIFIER_BYTES = 256;
export const MANAGED_CONTEXT_MAX_SERIALIZED_BYTES = 65_536;
export const MANAGED_CONTEXT_MAX_INTEGER = Number.MAX_SAFE_INTEGER;

export const MANAGED_CONTEXT_PROVENANCE = [
  'selected_source',
  'tool_read',
  'worker_result',
] as const;
export type ManagedContextProvenance = typeof MANAGED_CONTEXT_PROVENANCE[number];

export const MANAGED_CONTEXT_ROLES = ['parent', 'worker'] as const;
export type ManagedContextRole = typeof MANAGED_CONTEXT_ROLES[number];

export const MANAGED_CONTEXT_UNSAFE_CODES = [
  'dependency_conflict',
  'dependency_overflow',
  'manifest_malformed',
  'binding_ambiguous',
  'scope_mismatch',
  'persistence_failure',
  'unknown_manifest_version',
] as const;
export type ManagedContextUnsafeCode = typeof MANAGED_CONTEXT_UNSAFE_CODES[number];

export interface ManagedContextReference {
  schemaVersion: typeof MANAGED_CONTEXT_SCHEMA_VERSION;
  dependencyId: string;
  canonicalId: string;
  observedVersion: string;
  observedHash: string;
  sourceNamespace: string;
  sourceInstance: string;
  ownerUserId: number;
  projectId: string;
  workstreamId: string;
  workstreamRevision: number;
  provenance: ManagedContextProvenance;
  queryHash?: string;
  lane?: string;
  indexGeneration?: number;
}

export interface ManagedContextManifest {
  schemaVersion: typeof MANAGED_CONTEXT_SCHEMA_VERSION;
  references: ManagedContextReference[];
}

export interface ManagedContextScope {
  dispatchId: string;
  sessionId: string;
  ownerUserId: number;
  projectId: string;
  workstreamId: string;
  workstreamRevision: number;
  role: ManagedContextRole;
  hostEpoch: string;
  sdkSessionId: string;
  sdkTurnId: string | null;
}

export interface ManagedContextEnrollment extends ManagedContextScope {
  schemaVersion: typeof MANAGED_CONTEXT_SCHEMA_VERSION;
}

export interface ManagedContextAppend {
  schemaVersion: typeof MANAGED_CONTEXT_SCHEMA_VERSION;
  scope: ManagedContextScope;
  references: ManagedContextReference[];
  transitiveManifests?: ManagedContextManifest[];
}

export class ManagedContextContractError extends Error {
  readonly code = 'managed_context_input_invalid';

  constructor(readonly detail: 'invalid' | 'dependency_overflow' | 'unknown_manifest_version' = 'invalid') {
    super('managed_context_input_invalid');
  }
}

type UnknownRecord = Record<string, unknown>;

const REFERENCE_REQUIRED = [
  'schemaVersion', 'dependencyId', 'canonicalId', 'observedVersion',
  'observedHash', 'sourceNamespace', 'sourceInstance', 'ownerUserId',
  'projectId', 'workstreamId', 'workstreamRevision', 'provenance',
] as const;
const REFERENCE_OPTIONAL = ['queryHash', 'lane', 'indexGeneration'] as const;
const SCOPE_KEYS = [
  'dispatchId', 'sessionId', 'ownerUserId', 'projectId', 'workstreamId',
  'workstreamRevision', 'role', 'hostEpoch', 'sdkSessionId', 'sdkTurnId',
] as const;

function record(value: unknown): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ManagedContextContractError();
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ManagedContextContractError();
  }
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    keys.some((key) => !allowed.has(key))
  ) {
    throw new ManagedContextContractError();
  }
}

function schemaVersion(value: unknown): typeof MANAGED_CONTEXT_SCHEMA_VERSION {
  if (value !== MANAGED_CONTEXT_SCHEMA_VERSION) {
    throw new ManagedContextContractError(
      Number.isInteger(value) ? 'unknown_manifest_version' : 'invalid',
    );
  }
  return value;
}

function identifier(value: unknown): string {
  if (
    typeof value !== 'string' || value.length === 0 || value.trim() !== value ||
    Buffer.byteLength(value, 'utf8') > MANAGED_CONTEXT_MAX_IDENTIFIER_BYTES ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    value === '..' || value.startsWith('../') || value.endsWith('/..') || value.includes('/../')
  ) {
    throw new ManagedContextContractError();
  }
  return value;
}

function safePositiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ManagedContextContractError();
  }
  return value as number;
}

function safeNonnegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ManagedContextContractError();
  }
  return value as number;
}

function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new ManagedContextContractError();
  }
  return value;
}

function enforceManifestBounds(manifest: ManagedContextManifest): void {
  if (manifest.references.length > MANAGED_CONTEXT_MAX_REFERENCES) {
    throw new ManagedContextContractError('dependency_overflow');
  }
  if (Buffer.byteLength(JSON.stringify(manifest), 'utf8') > MANAGED_CONTEXT_MAX_SERIALIZED_BYTES) {
    throw new ManagedContextContractError('dependency_overflow');
  }
}

export function parseManagedContextReference(value: unknown): ManagedContextReference {
  const input = record(value);
  exactKeys(input, REFERENCE_REQUIRED, REFERENCE_OPTIONAL);
  const parsed: ManagedContextReference = {
    schemaVersion: schemaVersion(input.schemaVersion),
    dependencyId: identifier(input.dependencyId),
    canonicalId: identifier(input.canonicalId),
    observedVersion: identifier(input.observedVersion),
    observedHash: hash(input.observedHash),
    sourceNamespace: identifier(input.sourceNamespace),
    sourceInstance: identifier(input.sourceInstance),
    ownerUserId: safePositiveInteger(input.ownerUserId),
    projectId: identifier(input.projectId),
    workstreamId: identifier(input.workstreamId),
    workstreamRevision: safePositiveInteger(input.workstreamRevision),
    provenance: MANAGED_CONTEXT_PROVENANCE.includes(input.provenance as ManagedContextProvenance)
      ? input.provenance as ManagedContextProvenance
      : (() => { throw new ManagedContextContractError(); })(),
  };
  if (input.queryHash !== undefined) parsed.queryHash = hash(input.queryHash);
  if (input.lane !== undefined) parsed.lane = identifier(input.lane);
  if (input.indexGeneration !== undefined) {
    parsed.indexGeneration = safeNonnegativeInteger(input.indexGeneration);
  }
  return parsed;
}

export function parseManagedContextManifest(value: unknown): ManagedContextManifest {
  const input = record(value);
  exactKeys(input, ['schemaVersion', 'references']);
  const version = schemaVersion(input.schemaVersion);
  if (!Array.isArray(input.references)) throw new ManagedContextContractError();
  const manifest = {
    schemaVersion: version,
    references: input.references.map(parseManagedContextReference),
  };
  enforceManifestBounds(manifest);
  return manifest;
}

export function parseManagedContextScope(value: unknown): ManagedContextScope {
  const input = record(value);
  exactKeys(input, SCOPE_KEYS);
  if (input.sdkTurnId !== null && typeof input.sdkTurnId !== 'string') {
    throw new ManagedContextContractError();
  }
  return {
    dispatchId: identifier(input.dispatchId),
    sessionId: identifier(input.sessionId),
    ownerUserId: safePositiveInteger(input.ownerUserId),
    projectId: identifier(input.projectId),
    workstreamId: identifier(input.workstreamId),
    workstreamRevision: safePositiveInteger(input.workstreamRevision),
    role: MANAGED_CONTEXT_ROLES.includes(input.role as ManagedContextRole)
      ? input.role as ManagedContextRole
      : (() => { throw new ManagedContextContractError(); })(),
    hostEpoch: identifier(input.hostEpoch),
    sdkSessionId: identifier(input.sdkSessionId),
    sdkTurnId: input.sdkTurnId === null ? null : identifier(input.sdkTurnId),
  };
}

export function parseManagedContextEnrollment(value: unknown): ManagedContextEnrollment {
  const input = record(value);
  exactKeys(input, ['schemaVersion', ...SCOPE_KEYS]);
  const version = schemaVersion(input.schemaVersion);
  const scope = { ...input };
  delete scope.schemaVersion;
  return { schemaVersion: version, ...parseManagedContextScope(scope) };
}

export function parseManagedContextAppend(value: unknown): ManagedContextAppend {
  const input = record(value);
  exactKeys(input, ['schemaVersion', 'scope', 'references'], ['transitiveManifests']);
  const version = schemaVersion(input.schemaVersion);
  if (!Array.isArray(input.references)) throw new ManagedContextContractError();
  if (input.transitiveManifests !== undefined && !Array.isArray(input.transitiveManifests)) {
    throw new ManagedContextContractError();
  }
  const parsed: ManagedContextAppend = {
    schemaVersion: version,
    scope: parseManagedContextScope(input.scope),
    references: input.references.map(parseManagedContextReference),
  };
  if (input.transitiveManifests !== undefined) {
    parsed.transitiveManifests = input.transitiveManifests.map(parseManagedContextManifest);
  }
  const flattened = {
    schemaVersion: version,
    references: [
      ...parsed.references,
      ...(parsed.transitiveManifests ?? []).flatMap((manifest) => manifest.references),
    ],
  };
  enforceManifestBounds(flattened);
  return parsed;
}

export function parseManagedContextUnsafeCode(value: unknown): ManagedContextUnsafeCode {
  if (!MANAGED_CONTEXT_UNSAFE_CODES.includes(value as ManagedContextUnsafeCode)) {
    throw new ManagedContextContractError();
  }
  return value as ManagedContextUnsafeCode;
}
