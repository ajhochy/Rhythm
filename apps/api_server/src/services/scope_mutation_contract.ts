import { createHash } from 'node:crypto';

import {
  CORE_PERMISSION_ACTIONS,
  CORE_PERMISSION_NAMES,
  SCOPE_ALLOWLIST_FIELDS,
  SCOPE_PATCH_FIELDS,
} from './org_diagnosis_types';
import { parseStrictJson } from './strict_json';

export type ScopeProposalKind =
  | 'tighten-scope'
  | 'prune-scope'
  | 'refine-scope'
  | 'broaden-scope';
export type ScopeRemovalKind = Extract<ScopeProposalKind, 'tighten-scope' | 'prune-scope'>;
export type ScopeStateKind = Extract<ScopeProposalKind, 'refine-scope' | 'broaden-scope'>;
export type ScopeAllowlistField = (typeof SCOPE_ALLOWLIST_FIELDS)[number];
export type ScopeStateField = (typeof SCOPE_PATCH_FIELDS)[number];

const RESERVED_SCOPE_IDENTIFIERS = new Set(['__proto__', 'constructor', 'prototype']);
const CORE_PERMISSION_NAME_SET = new Set<string>(CORE_PERMISSION_NAMES);
const CORE_PERMISSION_ACTION_SET = new Set<string>(CORE_PERMISSION_ACTIONS);
const SCOPE_FIELD_SET = new Set<string>(SCOPE_PATCH_FIELDS);
const SCOPE_ALIASES = new Set([
  'removeMcps',
  'removedMcps',
  'removeSkills',
  'removedSkills',
  'removeAllowedMcps',
  'removeAllowedSkills',
  'addMcps',
  'addedMcps',
  'addSkills',
  'addedSkills',
  'addAllowedMcps',
  'addAllowedSkills',
  'setCorePermissions',
  'unsetCorePermissions',
]);

export function isReservedScopeIdentifier(name: unknown): name is string {
  return typeof name === 'string' && RESERVED_SCOPE_IDENTIFIERS.has(name.trim());
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Duplicate-aware callers pass parsed values here. Strings are deliberately
 * opaque: prose mentioning a scope word is not itself an operation.
 */
export function containsScopeBearingPayload(value: unknown): boolean {
  const seen = new WeakSet<object>();
  const inspect = (candidate: unknown, depth: number, agentConfigContext = false): boolean => {
    if (depth > 24) return true;
    if (!candidate || typeof candidate !== 'object') return false;
    if (seen.has(candidate)) return true;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      return candidate.some((entry) => inspect(entry, depth + 1, agentConfigContext));
    }

    const record = candidate as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.includes('scopePatch')) return true;
    if (keys.some((key) => SCOPE_FIELD_SET.has(key) || SCOPE_ALIASES.has(key))) return true;
    if (SCOPE_FIELD_SET.has(String(record.field))) return true;

    const target = record.target;
    const tiedToAgentConfig = agentConfigContext ||
      typeof record.agentConfigId === 'string' ||
      record.targetType === 'agent_config' ||
      record.target === 'agent_config' ||
      (isRecord(target) && (target.type === 'agent_config' || target.kind === 'agent_config'));
    if (
      tiedToAgentConfig &&
      keys.some((key) => ['field', 'operation', 'add', 'remove', 'set', 'unset', 'value'].includes(key))
    ) return true;

    return Object.values(record).some((entry) => inspect(entry, depth + 1, tiedToAgentConfig));
  };
  return inspect(value, 0);
}

function exactName(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} must contain exact non-empty string names without surrounding whitespace`);
  }
  if (isReservedScopeIdentifier(value)) {
    throw new Error(`${label} contains reserved scope identifier '${value}'`);
  }
  return value;
}

function exactNameArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a present non-empty array`);
  }
  const names = value.map((entry) => exactName(entry, label));
  if (new Set(names).size !== names.length) throw new Error(`${label} contains duplicate names`);
  return names;
}

function validateToolsMapValue(value: unknown, label: string): void {
  if (value === null) return;
  if (!Array.isArray(value)) throw new Error(`${label} must be null or a string array`);
  const names = value.map((entry) => exactName(entry, label));
  if (new Set(names).size !== names.length) throw new Error(`${label} contains duplicate tool names`);
}

type ParsedAllowlist =
  | { shape: 'array'; names: string[] }
  | { shape: 'map'; entries: [string, unknown][] };

function parseAllowlistBytes(value: string | null, label: string): ParsedAllowlist {
  if (value === null) return { shape: 'array', names: [] };
  let parsed: unknown;
  try {
    parsed = parseStrictJson(value, label);
  } catch (error) {
    if (error instanceof Error && /duplicate JSON member/.test(error.message)) throw error;
    throw new Error(`${label} contains malformed JSON`);
  }
  if (Array.isArray(parsed)) {
    const names = parsed.map((entry) => exactName(entry, label));
    if (new Set(names).size !== names.length) throw new Error(`${label} contains duplicate current entries`);
    return { shape: 'array', names };
  }
  if (!isRecord(parsed)) throw new Error(`${label} must be a string array or supported tools map`);
  const entries = Object.entries(parsed);
  for (const [name, tools] of entries) {
    exactName(name, `${label} map key`);
    validateToolsMapValue(tools, `${label}.${name}`);
  }
  return { shape: 'map', entries };
}

function isCorePermissionValue(value: unknown): boolean {
  if (typeof value === 'string') return CORE_PERMISSION_ACTION_SET.has(value);
  if (!isRecord(value) || Object.keys(value).length === 0) return false;
  return Object.entries(value).every(([pattern, action]) =>
    pattern.length > 0 &&
    pattern.trim() === pattern &&
    !isReservedScopeIdentifier(pattern) &&
    typeof action === 'string' &&
    CORE_PERMISSION_ACTION_SET.has(action));
}

function parseCoreBytes(value: string | null, label: string): Record<string, unknown> {
  if (value === null) return Object.create(null) as Record<string, unknown>;
  let parsed: unknown;
  try {
    parsed = parseStrictJson(value, label);
  } catch (error) {
    if (error instanceof Error && /duplicate JSON member/.test(error.message)) throw error;
    throw new Error(`${label} contains malformed JSON`);
  }
  if (!isRecord(parsed)) throw new Error(`${label} must be a semantically valid object`);
  const result = Object.create(null) as Record<string, unknown>;
  for (const [name, permission] of Object.entries(parsed)) {
    if (!CORE_PERMISSION_NAME_SET.has(name) || isReservedScopeIdentifier(name)) {
      throw new Error(`${label} contains unsupported core permission '${name}'`);
    }
    if (!isCorePermissionValue(permission)) {
      throw new Error(`${label}.${name} is not a supported permission action or pattern map`);
    }
    Object.defineProperty(result, name, {
      value: permission,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const extras = Object.keys(record).filter((key) => !allowed.includes(key));
  if (extras.length > 0) throw new Error(`${label} contains unsupported key(s): ${extras.join(', ')}`);
}

function targetId(value: unknown): string {
  return exactName(value, 'agentConfigId');
}

export interface ParsedScopeMutation {
  proposalKind: ScopeProposalKind;
  agentConfigId: string;
  field: ScopeStateField;
  add?: string[];
  remove?: string[];
  set?: Record<string, unknown>;
  unset?: string[];
}

export function parseScopeMutation(
  proposalKind: ScopeProposalKind,
  exactChangeJson: string,
): ParsedScopeMutation {
  if (
    proposalKind !== 'tighten-scope' &&
    proposalKind !== 'prune-scope' &&
    proposalKind !== 'refine-scope' &&
    proposalKind !== 'broaden-scope'
  ) {
    throw new Error(`Unsupported scope proposal kind: ${String(proposalKind)}`);
  }
  if (typeof exactChangeJson !== 'string' || !exactChangeJson.trim()) {
    throw new Error(`${proposalKind} requires exact non-empty change_json bytes`);
  }
  let parsed: unknown;
  try {
    parsed = parseStrictJson(exactChangeJson, `${proposalKind} change_json`);
  } catch (error) {
    if (error instanceof Error && /duplicate JSON member/.test(error.message)) throw error;
    throw new Error(`${proposalKind} change_json is malformed`);
  }
  if (!isRecord(parsed)) throw new Error(`${proposalKind} change_json must be an object`);

  if (proposalKind === 'tighten-scope' || proposalKind === 'prune-scope') {
    assertExactKeys(parsed, ['agentConfigId', 'field', 'remove'], proposalKind);
    const field = parsed.field;
    if (field !== 'allowedMcpsJson' && field !== 'allowedSkillsJson') {
      throw new Error(`${proposalKind} field must be an allowlist field`);
    }
    const remove = exactNameArray(parsed.remove, `${proposalKind}.remove`);
    if (field === 'allowedMcpsJson') {
      const coreName = remove.find((name) => CORE_PERMISSION_NAME_SET.has(name));
      if (coreName) throw new Error(`core permission '${coreName}' cannot be used as an MCP allowlist name`);
    }
    return {
      proposalKind,
      agentConfigId: targetId(parsed.agentConfigId),
      field,
      remove,
    };
  }

  if (proposalKind === 'broaden-scope') {
    assertExactKeys(parsed, ['agentConfigId', 'field', 'add'], proposalKind);
    const field = parsed.field;
    if (field !== 'allowedMcpsJson' && field !== 'allowedSkillsJson') {
      throw new Error('broaden-scope field must be an allowlist field');
    }
    const add = exactNameArray(parsed.add, 'broaden-scope.add');
    if (field === 'allowedMcpsJson') {
      const coreName = add.find((name) => CORE_PERMISSION_NAME_SET.has(name));
      if (coreName) throw new Error(`core permission '${coreName}' cannot be used as an MCP allowlist name`);
    }
    return {
      proposalKind,
      agentConfigId: targetId(parsed.agentConfigId),
      field,
      add,
    };
  }

  if (!Object.prototype.hasOwnProperty.call(parsed, 'scopePatch') || !isRecord(parsed.scopePatch)) {
    throw new Error('refine-scope requires a nested scopePatch object');
  }
  const outsideScopePatch = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(parsed)) {
    if (key !== 'scopePatch') Object.defineProperty(outsideScopePatch, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  if (containsScopeBearingPayload(outsideScopePatch)) {
    throw new Error('refine-scope contains a scope-bearing operation outside the canonical scopePatch');
  }
  const smuggledRootOperation = ['agentConfigId', 'field', 'add', 'remove', 'set', 'unset']
    .find((key) => Object.prototype.hasOwnProperty.call(parsed, key));
  if (smuggledRootOperation) {
    throw new Error(`refine-scope contains unsupported root operation '${smuggledRootOperation}'`);
  }
  const patch = parsed.scopePatch;
  assertExactKeys(patch, ['agentConfigId', 'field', 'add', 'remove', 'set', 'unset'], 'refine-scope.scopePatch');
  const field = patch.field;
  if (field !== 'allowedMcpsJson' && field !== 'allowedSkillsJson' && field !== 'corePermissionsJson') {
    throw new Error('refine-scope field is unsupported');
  }
  const base = { proposalKind, agentConfigId: targetId(patch.agentConfigId), field } as const;

  if (field === 'allowedMcpsJson' || field === 'allowedSkillsJson') {
    if (Object.prototype.hasOwnProperty.call(patch, 'set') || Object.prototype.hasOwnProperty.call(patch, 'unset')) {
      throw new Error('allowlist scope patches cannot contain set/unset');
    }
    const hasAdd = Object.prototype.hasOwnProperty.call(patch, 'add');
    const hasRemove = Object.prototype.hasOwnProperty.call(patch, 'remove');
    if (!hasAdd && !hasRemove) throw new Error('allowlist scope patch requires add or remove');
    const add = hasAdd ? exactNameArray(patch.add, 'refine-scope.add') : undefined;
    const remove = hasRemove ? exactNameArray(patch.remove, 'refine-scope.remove') : undefined;
    if (field === 'allowedMcpsJson') {
      const coreName = [...(add ?? []), ...(remove ?? [])].find((name) => CORE_PERMISSION_NAME_SET.has(name));
      if (coreName) throw new Error(`core permission '${coreName}' cannot be used as an MCP allowlist name`);
    }
    const overlap = add?.find((name) => remove?.includes(name));
    if (overlap) throw new Error(`refine-scope add/remove overlap on '${overlap}'`);
    return { ...base, ...(add ? { add } : {}), ...(remove ? { remove } : {}) };
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'add') || Object.prototype.hasOwnProperty.call(patch, 'remove')) {
    throw new Error('corePermissionsJson scope patches cannot contain add/remove');
  }
  const hasSet = Object.prototype.hasOwnProperty.call(patch, 'set');
  const hasUnset = Object.prototype.hasOwnProperty.call(patch, 'unset');
  if (!hasSet && !hasUnset) throw new Error('corePermissionsJson scope patch requires set or unset');
  if (hasSet && (!isRecord(patch.set) || Object.keys(patch.set).length === 0)) {
    throw new Error('corePermissionsJson set must be a present non-empty object');
  }
  const set = hasSet ? patch.set as Record<string, unknown> : undefined;
  if (set) {
    for (const [name, permission] of Object.entries(set)) {
      exactName(name, 'corePermissionsJson.set');
      if (!CORE_PERMISSION_NAME_SET.has(name)) {
        throw new Error(`MCP server or unknown name '${name}' cannot be used as a core permission`);
      }
      if (!isCorePermissionValue(permission)) throw new Error(`invalid core permission value for '${name}'`);
    }
  }
  const unset = hasUnset ? exactNameArray(patch.unset, 'corePermissionsJson.unset') : undefined;
  if (unset) {
    for (const name of unset) {
      if (!CORE_PERMISSION_NAME_SET.has(name)) {
        throw new Error(`MCP server or unknown name '${name}' cannot be used as a core permission`);
      }
    }
  }
  const overlap = Object.keys(set ?? {}).find((name) => unset?.includes(name));
  if (overlap) throw new Error(`corePermissionsJson set/unset overlap on '${overlap}'`);
  return { ...base, ...(set ? { set } : {}), ...(unset ? { unset } : {}) };
}

export interface ScopeDeltaV2RemovedEntry {
  name: string;
  priorValue: unknown;
  priorIndex: number;
}

export interface PreparedScopeMutation extends ParsedScopeMutation {
  priorValue: string | null;
  expectedAppliedValue: string;
  removedEntries: ScopeDeltaV2RemovedEntry[];
}

export function prepareScopeMutation(
  proposalKind: ScopeProposalKind,
  exactChangeJson: string,
  priorValue: string | null,
): PreparedScopeMutation {
  const mutation = parseScopeMutation(proposalKind, exactChangeJson);
  const removedEntries: ScopeDeltaV2RemovedEntry[] = [];
  let expectedAppliedValue: string;

  if (mutation.field === 'allowedMcpsJson' || mutation.field === 'allowedSkillsJson') {
    if (priorValue === null) {
      throw new Error(`${mutation.field} is unrestricted and cannot be mutated with add/remove operations`);
    }
    const current = parseAllowlistBytes(priorValue, mutation.field);
    const currentNames = current.shape === 'array'
      ? current.names
      : current.entries.map(([name]) => name);
    if (mutation.field === 'allowedMcpsJson') {
      const coreName = currentNames.find((name) => CORE_PERMISSION_NAME_SET.has(name));
      if (coreName) throw new Error(`allowedMcpsJson contains core permission name '${coreName}'`);
    }
    for (const name of mutation.remove ?? []) {
      const priorIndex = currentNames.indexOf(name);
      if (priorIndex < 0) throw new Error(`requested removal '${name}' is not present exactly once`);
      removedEntries.push({
        name,
        priorValue: current.shape === 'array' ? name : current.entries[priorIndex][1],
        priorIndex,
      });
    }
    for (const name of mutation.add ?? []) {
      if (currentNames.includes(name)) throw new Error(`requested addition '${name}' is already present`);
    }
    const remove = new Set(mutation.remove ?? []);
    if (current.shape === 'array') {
      expectedAppliedValue = JSON.stringify([
        ...current.names.filter((name) => !remove.has(name)),
        ...(mutation.add ?? []),
      ]);
    } else {
      const next = Object.create(null) as Record<string, unknown>;
      for (const [name, tools] of current.entries) {
        if (!remove.has(name)) Object.defineProperty(next, name, {
          value: tools, enumerable: true, configurable: true, writable: true,
        });
      }
      for (const name of mutation.add ?? []) Object.defineProperty(next, name, {
        value: [], enumerable: true, configurable: true, writable: true,
      });
      expectedAppliedValue = JSON.stringify(next);
    }
    parseAllowlistBytes(expectedAppliedValue, `${mutation.field} applied value`);
  } else {
    const current = parseCoreBytes(priorValue, mutation.field);
    const next = Object.create(null) as Record<string, unknown>;
    for (const [name, permission] of Object.entries(current)) Object.defineProperty(next, name, {
      value: permission, enumerable: true, configurable: true, writable: true,
    });
    for (const name of mutation.unset ?? []) {
      if (!Object.prototype.hasOwnProperty.call(current, name)) {
        throw new Error(`requested unset '${name}' is not present exactly once`);
      }
      delete next[name];
    }
    for (const [name, permission] of Object.entries(mutation.set ?? {})) {
      const currentValue = current[name];
      let nextValue = permission;
      if (isRecord(currentValue) && isRecord(permission)) {
        nextValue = { ...currentValue, ...permission };
      }
      if (JSON.stringify(currentValue) === JSON.stringify(nextValue)) {
        throw new Error(`requested set '${name}' is already present with the same value`);
      }
      Object.defineProperty(next, name, {
        value: nextValue, enumerable: true, configurable: true, writable: true,
      });
    }
    expectedAppliedValue = JSON.stringify(next);
    parseCoreBytes(expectedAppliedValue, 'corePermissionsJson applied value');
  }

  if (expectedAppliedValue === priorValue) throw new Error(`${proposalKind} must produce a real exact mutation`);
  return { ...mutation, priorValue, expectedAppliedValue, removedEntries };
}

export interface ScopeStateV2Snapshot {
  version: 'scope-state-v2';
  proposalKind: ScopeStateKind;
  target: { type: 'agent_config'; id: string };
  field: ScopeStateField;
  priorValue: string | null;
  expectedAppliedValue: string;
  expectedAppliedHash: string;
  changeJsonHash: string;
  semanticProofHash: string;
  integrityHash: string;
}

export interface ScopeDeltaV2Snapshot {
  version: 'scope-delta-v2';
  proposalKind: ScopeRemovalKind;
  target: { type: 'agent_config'; id: string };
  field: ScopeAllowlistField;
  priorValue: string | null;
  requestedRemove: string[];
  removedEntries: ScopeDeltaV2RemovedEntry[];
  expectedAppliedValue: string;
  expectedAppliedHash: string;
  changeJsonHash: string;
  semanticProofHash: string;
  integrityHash: string;
}

function semanticMaterial(prepared: PreparedScopeMutation, changeJsonHash: string): string {
  return JSON.stringify({
    proposalKind: prepared.proposalKind,
    target: { type: 'agent_config', id: prepared.agentConfigId },
    field: prepared.field,
    priorValue: prepared.priorValue,
    expectedAppliedValue: prepared.expectedAppliedValue,
    changeJsonHash,
  });
}

function snapshotIntegrityMaterial(snapshot: Omit<ScopeStateV2Snapshot | ScopeDeltaV2Snapshot, 'integrityHash'>): string {
  return JSON.stringify(snapshot);
}

export function createScopeStateV2Snapshot(
  agentConfigId: string,
  field: ScopeStateField,
  priorValue: string | null,
  expectedAppliedValue: string,
  exactChangeJson: string,
  proposalKind: ScopeStateKind,
): ScopeStateV2Snapshot {
  if (proposalKind !== 'refine-scope' && proposalKind !== 'broaden-scope') {
    throw new Error(`scope-state-v2 does not support proposal kind '${String(proposalKind)}'`);
  }
  const prepared = prepareScopeMutation(proposalKind, exactChangeJson, priorValue);
  if (
    prepared.agentConfigId !== agentConfigId ||
    prepared.field !== field ||
    prepared.expectedAppliedValue !== expectedAppliedValue
  ) throw new Error('scope-state-v2 caller-supplied target/applied bytes do not match semantic replay');
  const changeJsonHash = hash(exactChangeJson);
  const partial: Omit<ScopeStateV2Snapshot, 'integrityHash'> = {
    version: 'scope-state-v2',
    proposalKind,
    target: { type: 'agent_config', id: agentConfigId },
    field,
    priorValue,
    expectedAppliedValue,
    expectedAppliedHash: hash(expectedAppliedValue),
    changeJsonHash,
    semanticProofHash: hash(semanticMaterial(prepared, changeJsonHash)),
  };
  return { ...partial, integrityHash: hash(snapshotIntegrityMaterial(partial)) };
}

export function createScopeDeltaV2Snapshot(
  agentConfigId: string,
  field: ScopeAllowlistField,
  priorValue: string | null,
  remove: string[],
  proposalKind: ScopeRemovalKind,
  exactChangeJson: string,
): ScopeDeltaV2Snapshot {
  if (proposalKind !== 'tighten-scope' && proposalKind !== 'prune-scope') {
    throw new Error(`scope-delta-v2 does not support proposal kind '${String(proposalKind)}'`);
  }
  const prepared = prepareScopeMutation(proposalKind, exactChangeJson, priorValue);
  if (
    prepared.agentConfigId !== agentConfigId ||
    prepared.field !== field ||
    JSON.stringify(prepared.remove) !== JSON.stringify(remove)
  ) throw new Error('scope-delta-v2 caller-supplied target/remove does not match semantic replay');
  const changeJsonHash = hash(exactChangeJson);
  const partial: Omit<ScopeDeltaV2Snapshot, 'integrityHash'> = {
    version: 'scope-delta-v2',
    proposalKind,
    target: { type: 'agent_config', id: agentConfigId },
    field,
    priorValue,
    requestedRemove: [...remove],
    removedEntries: prepared.removedEntries,
    expectedAppliedValue: prepared.expectedAppliedValue,
    expectedAppliedHash: hash(prepared.expectedAppliedValue),
    changeJsonHash,
    semanticProofHash: hash(semanticMaterial(prepared, changeJsonHash)),
  };
  return { ...partial, integrityHash: hash(snapshotIntegrityMaterial(partial)) };
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function structuralSnapshot(value: unknown): value is ScopeStateV2Snapshot | ScopeDeltaV2Snapshot {
  if (!isRecord(value) || (value.version !== 'scope-state-v2' && value.version !== 'scope-delta-v2')) return false;
  const target = value.target;
  if (!isRecord(target) || target.type !== 'agent_config' || typeof target.id !== 'string') return false;
  if (Object.keys(target).sort().join(',') !== 'id,type') return false;
  if (
    typeof value.expectedAppliedValue !== 'string' ||
    (typeof value.priorValue !== 'string' && value.priorValue !== null) ||
    !isSha256(value.expectedAppliedHash) ||
    !isSha256(value.changeJsonHash) ||
    !isSha256(value.semanticProofHash) ||
    !isSha256(value.integrityHash)
  ) return false;
  if (value.version === 'scope-state-v2') {
    const stateKeys = [
      'changeJsonHash', 'expectedAppliedHash', 'expectedAppliedValue', 'field',
      'integrityHash', 'priorValue', 'proposalKind', 'semanticProofHash', 'target', 'version',
    ].sort().join(',');
    return (
      Object.keys(value).sort().join(',') === stateKeys &&
      (value.proposalKind === 'refine-scope' || value.proposalKind === 'broaden-scope') &&
      (value.field === 'allowedMcpsJson' || value.field === 'allowedSkillsJson' || value.field === 'corePermissionsJson')
    );
  }
  const deltaKeys = [
    'changeJsonHash', 'expectedAppliedHash', 'expectedAppliedValue', 'field',
    'integrityHash', 'priorValue', 'proposalKind', 'removedEntries', 'requestedRemove',
    'semanticProofHash', 'target', 'version',
  ].sort().join(',');
  return (
    Object.keys(value).sort().join(',') === deltaKeys &&
    (value.proposalKind === 'tighten-scope' || value.proposalKind === 'prune-scope') &&
    (value.field === 'allowedMcpsJson' || value.field === 'allowedSkillsJson') &&
    Array.isArray(value.requestedRemove) &&
    Array.isArray(value.removedEntries)
  );
}

export type VerifiedScopeSnapshot = {
  snapshot: ScopeStateV2Snapshot | ScopeDeltaV2Snapshot;
  prepared: PreparedScopeMutation;
};

export function verifyScopeSnapshotForRevert(
  value: unknown,
  liveProposalKind: string,
  exactChangeJson: string | null,
): VerifiedScopeSnapshot | null {
  if (!structuralSnapshot(value) || value.proposalKind !== liveProposalKind || !exactChangeJson) return null;
  const { integrityHash, ...partial } = value;
  if (hash(snapshotIntegrityMaterial(partial)) !== integrityHash) return null;
  if (hash(value.expectedAppliedValue) !== value.expectedAppliedHash) return null;
  if (hash(exactChangeJson) !== value.changeJsonHash) return null;
  let prepared: PreparedScopeMutation;
  try {
    prepared = prepareScopeMutation(value.proposalKind, exactChangeJson, value.priorValue);
  } catch {
    return null;
  }
  if (
    prepared.agentConfigId !== value.target.id ||
    prepared.field !== value.field ||
    prepared.expectedAppliedValue !== value.expectedAppliedValue ||
    hash(semanticMaterial(prepared, value.changeJsonHash)) !== value.semanticProofHash
  ) return null;
  if (value.version === 'scope-delta-v2') {
    if (
      JSON.stringify(prepared.remove) !== JSON.stringify(value.requestedRemove) ||
      JSON.stringify(prepared.removedEntries) !== JSON.stringify(value.removedEntries)
    ) return null;
  }
  return { snapshot: value, prepared };
}

export function isScopeSnapshotVersion(value: unknown): boolean {
  return isRecord(value) && (value.version === 'scope-state-v2' || value.version === 'scope-delta-v2');
}
