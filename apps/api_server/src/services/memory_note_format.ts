/**
 * Shared parser/renderer for Memory-Vault markdown notes.
 *
 * The vault is user-editable and is the source of truth. Parsing therefore
 * has two deliberately different views:
 *
 *  - `MemoryNoteDocument.frontmatter` retains every YAML key/value so a
 *    read-modify-write path cannot silently strip fields it does not know.
 *  - the normalized `kind`, `tags`, and `body` fields preserve the tolerant
 *    behavior expected by the derived-index paths.
 *
 * A successfully parsed document also retains its original bytes.
 * `renderParsedMemoryNote(document)` is consequently a true no-op and returns
 * those bytes verbatim. Once a caller supplies a patch, rendering becomes
 * deterministic: known Rhythm/OKF keys first, followed by unknown keys in
 * their original insertion order.
 */

import * as yaml from 'js-yaml';

export const VALID_MEMORY_KINDS = [
  'fact',
  'person',
  'project',
  'preference',
  'context',
] as const;
export type MemoryKind = (typeof VALID_MEMORY_KINDS)[number];

export const VALID_MEMORY_STATUSES = ['draft', 'stable', 'deprecated'] as const;
export type MemoryStatus = (typeof VALID_MEMORY_STATUSES)[number];
export type MemoryTrustTier = 'unverified' | 'machine' | 'human';
export type MemoryActorKind = 'agent' | 'human' | 'process';

export interface MemoryActor {
  kind: MemoryActorKind;
  id: string;
  version?: string;
}

export interface GeneratedMetadata {
  by: string;
  at: string;
}

export interface VerificationEntry {
  by: string;
  at: string;
}

export interface NoteFrontmatter extends Record<string, unknown> {
  id: string;
  kind: MemoryKind;
  tags: string[];
  created: string;
  updated: string;
  source: string;
  status?: MemoryStatus;
  stale_after?: string;
  generated?: GeneratedMetadata;
  verified?: VerificationEntry[];
}

export interface MemoryNoteDocument {
  /** Exact caller-provided bytes, including original line endings. */
  originalRaw: string;
  /** Every YAML key/value in insertion order. Empty for malformed/plain notes. */
  frontmatter: Record<string, unknown>;
  /** Normalized, validated Rhythm kind. Unknown kinds fall back to `fact`. */
  kind: MemoryKind;
  /** Stringified tag scalars. Invalid/non-array tag values become `[]`. */
  tags: string[];
  /** Trimmed markdown body, matching the legacy parser contract. */
  body: string;
  /** Tolerant lifecycle view; absent/unknown status reads as stable. */
  status: MemoryStatus;
  /** Valid YYYY-MM-DD value, or undefined for absent/malformed input. */
  staleAfter?: string;
  /** Valid producer metadata, or undefined for absent/malformed input. */
  generated?: GeneratedMetadata;
  /** Valid verification entries; absent/malformed entries read as an empty array. */
  verified: VerificationEntry[];
  /** True only when a delimited YAML mapping parsed successfully. */
  hasValidFrontmatter: boolean;
}

export interface RenderParsedMemoryNotePatch {
  frontmatter?: Record<string, unknown>;
  body?: string;
}

const KNOWN_KEY_ORDER = [
  'id',
  'kind',
  'tags',
  'created',
  'updated',
  'source',
  'status',
  'stale_after',
  'generated',
  'verified',
  'sources',
  'usage_window',
] as const;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UTC_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export function formatActor(actor: MemoryActor): string {
  const id = actor.id.trim();
  if (!id || id.includes(':')) {
    throw new Error('Memory actor id must be non-empty and cannot contain ":".');
  }
  if (actor.kind === 'agent') {
    const version = actor.version?.trim();
    if (!version || version.includes(':') || version.includes('/')) {
      throw new Error('Agent actors require a non-empty version without ":" or "/".');
    }
    if (id.includes('/')) {
      throw new Error('Agent actor id cannot contain "/".');
    }
    return `agent:${id}/${version}`;
  }
  if (actor.version !== undefined) {
    throw new Error(`${actor.kind} actors do not accept a version.`);
  }
  return `${actor.kind}:${id}`;
}

export function parseActor(value: unknown): MemoryActor | null {
  if (typeof value !== 'string') return null;
  if (value.startsWith('agent:')) {
    const match = /^agent:([^/:]+)\/([^/:]+)$/.exec(value);
    return match
      ? { kind: 'agent', id: match[1], version: match[2] }
      : null;
  }
  const match = /^(human|process):([^:]+)$/.exec(value);
  return match
    ? { kind: match[1] as 'human' | 'process', id: match[2] }
    : null;
}

export const DEFAULT_MEMORY_ACTOR = formatActor({
  kind: 'agent',
  id: 'rhythm',
  version: '1',
});
export const CONSOLIDATION_MEMORY_ACTOR = formatActor({
  kind: 'process',
  id: 'consolidation',
});

function isPlainMapping(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeKind(value: unknown): MemoryKind {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (VALID_MEMORY_KINDS as readonly string[]).includes(candidate)
    ? candidate as MemoryKind
    : 'fact';
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => (
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean'
    ))
    .map(String);
}

function dateOnly(value: unknown): string | undefined {
  if (value instanceof Date && Number.isNaN(value.valueOf())) return undefined;
  const candidate = value instanceof Date
    ? value.toISOString().slice(0, 10)
    : typeof value === 'string'
      ? value
      : '';
  if (!DATE_ONLY_PATTERN.test(candidate)) return undefined;
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== candidate
    ? undefined
    : candidate;
}

function utcInstant(value: unknown): string | undefined {
  if (value instanceof Date && Number.isNaN(value.valueOf())) return undefined;
  const candidate = value instanceof Date
    ? value.toISOString()
    : typeof value === 'string'
      ? value
      : '';
  if (!UTC_INSTANT_PATTERN.test(candidate)) return undefined;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.valueOf())) return undefined;
  const fractional = /\.(\d{1,3})Z$/.exec(candidate)?.[1];
  const canonical = fractional === undefined
    ? candidate.replace(/Z$/, '.000Z')
    : candidate.replace(`.${fractional}Z`, `.${fractional.padEnd(3, '0')}Z`);
  return parsed.toISOString() === canonical ? canonical : undefined;
}

function metadataEntry(value: unknown): GeneratedMetadata | undefined {
  if (!isPlainMapping(value)) return undefined;
  const by = typeof value.by === 'string' ? value.by : '';
  const at = utcInstant(value.at);
  if (!parseActor(by) || !at) return undefined;
  return { by, at };
}

export function memoryStatus(
  frontmatter: Record<string, unknown>,
): MemoryStatus {
  const value = typeof frontmatter.status === 'string'
    ? frontmatter.status
    : '';
  return (VALID_MEMORY_STATUSES as readonly string[]).includes(value)
    ? value as MemoryStatus
    : 'stable';
}

export function staleAfter(
  frontmatter: Record<string, unknown>,
): string | undefined {
  return dateOnly(frontmatter.stale_after);
}

export function generatedMetadata(
  frontmatter: Record<string, unknown>,
): GeneratedMetadata | undefined {
  return metadataEntry(frontmatter.generated);
}

export function verificationEntries(
  frontmatter: Record<string, unknown>,
): VerificationEntry[] {
  if (!Array.isArray(frontmatter.verified)) return [];
  return frontmatter.verified
    .map(metadataEntry)
    .filter((entry): entry is VerificationEntry => entry !== undefined);
}

export function trustTier(
  frontmatter: Record<string, unknown>,
): MemoryTrustTier {
  const entries = verificationEntries(frontmatter);
  if (entries.length === 0) return 'unverified';
  return entries.some((entry) => parseActor(entry.by)?.kind === 'human')
    ? 'human'
    : 'machine';
}

export function isStale(
  frontmatter: Record<string, unknown>,
  today: Date | string = new Date(),
): boolean {
  const expiry = staleAfter(frontmatter);
  if (!expiry) return false;
  const current = dateOnly(today);
  return current !== undefined && current >= expiry;
}

export function isActive(
  frontmatter: Record<string, unknown>,
  today: Date | string = new Date(),
): boolean {
  return memoryStatus(frontmatter) !== 'deprecated' &&
    !isStale(frontmatter, today);
}

export interface MergedLifecycleMetadata {
  status: MemoryStatus;
  stale_after?: string;
  verified?: VerificationEntry[];
}

/**
 * Fold lifecycle metadata for a semantic merge.
 *
 * A cluster is deprecated only when every member is deprecated. Otherwise a
 * stable member wins over draft, and an all-draft cluster remains draft.
 */
export function mergeLifecycleMetadata(
  members: ReadonlyArray<Record<string, unknown>>,
): MergedLifecycleMetadata {
  const statuses = members.map(memoryStatus);
  const status: MemoryStatus = statuses.length > 0 &&
    statuses.every((value) => value === 'deprecated')
    ? 'deprecated'
    : statuses.some((value) => value === 'stable')
      ? 'stable'
      : 'draft';
  const expiries = members
    .map(staleAfter)
    .filter((value): value is string => value !== undefined)
    .sort();
  const seen = new Set<string>();
  const verified: VerificationEntry[] = [];
  for (const member of members) {
    for (const entry of verificationEntries(member)) {
      const key = `${entry.by}\u0000${entry.at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      verified.push(entry);
    }
  }
  return {
    status,
    stale_after: expiries[0],
    verified: verified.length > 0 ? verified : undefined,
  };
}

function splitFrontmatter(normalized: string): {
  yamlText: string;
  body: string;
} | null {
  if (!normalized.startsWith('---\n')) return null;
  const afterOpen = normalized.slice(4);
  const close = /\n---[ \t]*(?:\n|$)/.exec(afterOpen);
  if (!close || close.index === undefined) return null;
  return {
    yamlText: afterOpen.slice(0, close.index),
    body: afterOpen.slice(close.index + close[0].length),
  };
}

/**
 * Parse a complete markdown note. Never throws.
 *
 * js-yaml's JSON schema is safe and deliberately leaves date-shaped scalars as
 * strings, allowing strict calendar validation instead of JavaScript's rollover
 * semantics. Executable tags such as `!!js/function` are never constructed.
 * Any YAML error, missing/unterminated delimiter, or non-map root degrades to
 * the legacy behavior where the whole normalized file is the body.
 */
export function parseMemoryNote(raw: string): MemoryNoteDocument {
  const originalRaw = typeof raw === 'string' ? raw : String(raw ?? '');
  const normalized = originalRaw.replace(/\r\n/g, '\n');
  const split = splitFrontmatter(normalized);
  if (!split) {
    return {
      originalRaw,
      frontmatter: {},
      kind: 'fact',
      tags: [],
      body: normalized.trim(),
      status: 'stable',
      verified: [],
      hasValidFrontmatter: false,
    };
  }

  try {
    const loaded = yaml.load(split.yamlText, { schema: yaml.JSON_SCHEMA });
    if (!isPlainMapping(loaded)) {
      return {
        originalRaw,
        frontmatter: {},
        kind: 'fact',
        tags: [],
        body: normalized.trim(),
        status: 'stable',
        verified: [],
        hasValidFrontmatter: false,
      };
    }
    return {
      originalRaw,
      frontmatter: loaded,
      kind: normalizeKind(loaded.kind),
      tags: normalizeTags(loaded.tags),
      body: split.body.trim(),
      status: memoryStatus(loaded),
      staleAfter: staleAfter(loaded),
      generated: generatedMetadata(loaded),
      verified: verificationEntries(loaded),
      hasValidFrontmatter: true,
    };
  } catch {
    return {
      originalRaw,
      frontmatter: {},
      kind: 'fact',
      tags: [],
      body: normalized.trim(),
      status: 'stable',
      verified: [],
      hasValidFrontmatter: false,
    };
  }
}

function orderedFrontmatter(
  frontmatter: Record<string, unknown>,
): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const key of KNOWN_KEY_ORDER) {
    if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
      ordered[key] = frontmatter[key];
    }
  }
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!Object.prototype.hasOwnProperty.call(ordered, key)) {
      ordered[key] = value;
    }
  }
  return ordered;
}

/** Deterministically render an arbitrary frontmatter mapping plus markdown body. */
export function renderMemoryNote(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  const dumped = yaml.dump(orderedFrontmatter(frontmatter), {
    noCompatMode: true,
    noRefs: true,
    lineWidth: -1,
    sortKeys: false,
  }).trimEnd().replace(
    /^(created|updated|stale_after): '(\d{4}-\d{2}-\d{2})'$/gm,
    '$1: $2',
  );
  return ['---', dumped, '---', '', body.trim(), ''].join('\n');
}

/**
 * Render a parsed note.
 *
 * Without a patch this is byte-identical by construction. With a patch,
 * frontmatter is shallow-merged so unknown keys survive and the deterministic
 * renderer is used.
 */
export function renderParsedMemoryNote(
  document: MemoryNoteDocument,
  patch?: RenderParsedMemoryNotePatch,
): string {
  if (!patch) return document.originalRaw;
  return renderMemoryNote(
    { ...document.frontmatter, ...(patch.frontmatter ?? {}) },
    patch.body ?? document.body,
  );
}

export function frontmatterString(
  frontmatter: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = frontmatter[key];
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}
