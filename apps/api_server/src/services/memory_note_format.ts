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

export interface NoteFrontmatter extends Record<string, unknown> {
  id: string;
  kind: MemoryKind;
  tags: string[];
  created: string;
  updated: string;
  source: string;
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
 * js-yaml's default `load` schema is the safe schema in v4: JavaScript-specific
 * executable tags such as `!!js/function` are not constructed. Any YAML error,
 * missing/unterminated delimiter, or non-map root degrades to the legacy
 * behavior where the whole normalized file is the body.
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
      hasValidFrontmatter: false,
    };
  }

  try {
    const loaded = yaml.load(split.yamlText);
    if (!isPlainMapping(loaded)) {
      return {
        originalRaw,
        frontmatter: {},
        kind: 'fact',
        tags: [],
        body: normalized.trim(),
        hasValidFrontmatter: false,
      };
    }
    return {
      originalRaw,
      frontmatter: loaded,
      kind: normalizeKind(loaded.kind),
      tags: normalizeTags(loaded.tags),
      body: split.body.trim(),
      hasValidFrontmatter: true,
    };
  } catch {
    return {
      originalRaw,
      frontmatter: {},
      kind: 'fact',
      tags: [],
      body: normalized.trim(),
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
