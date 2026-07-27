/**
 * memory_similarity.ts — shared lexical-overlap scorer for agent memory
 * dedup/merge decisions (Issue #859: merge-on-capture + consolidation pass).
 *
 * Mirrors the Jaccard-over-tokens approach already used for skill relevance
 * (`skill_retrieval.ts`) and skill overlap detection
 * (`org_audit_service.ts` / `scope_hygiene_generator.ts`) — reusing the same
 * shape keeps memory dedup consistent with the rest of the org-optimizer
 * family rather than inventing a third scorer.
 *
 * Deliberately simple and dependency-free: no embeddings, no LLM call. Good
 * enough to catch "restates/extends the same theme" (the #859 target) while
 * staying fast enough to run inline on every `remember()` call.
 */

import { isDeepStrictEqual } from 'node:util';

import {
  MEMORY_SOURCE_ID_PATTERN,
  isReversedMemoryUsageWindow,
  memorySources,
  memoryUsageWindow,
  validateNoteSources,
  type MemorySource,
  type MemoryUsageWindow,
} from './memory_note_format';
import { logger } from '../utils/logger';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be',
  'been', 'to', 'of', 'in', 'on', 'for', 'with', 'as', 'at', 'by', 'from',
  'this', 'that', 'it', 'its', 'their', 'they', 'he', 'she', 'his', 'her',
]);

/**
 * Tokenize text into a lowercase, punctuation-stripped, stopword-filtered set
 * of words. Tokens of length <= 2 are dropped as noise (mirrors
 * `skill_retrieval.tokenize`'s length filter, tightened slightly since memory
 * content is prose rather than skill metadata).
 */
export function tokenizeForSimilarity(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  for (const raw of text.toLowerCase().split(/\s+/)) {
    const w = raw.replace(/[^a-z0-9']+/g, '');
    if (w.length <= 2) continue;
    if (STOPWORDS.has(w)) continue;
    out.add(w);
  }
  return out;
}

/** Jaccard similarity between two token sets: |intersection| / |union|. */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter++;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Convenience: Jaccard similarity directly between two strings. */
export function textSimilarity(a: string, b: string): number {
  return jaccardSimilarity(tokenizeForSimilarity(a), tokenizeForSimilarity(b));
}

/**
 * The similarity bar a NEW memory must clear against an EXISTING memory (same
 * kind) to be treated as "restating/extending the same theme" and therefore
 * merged rather than written as a new note. Deliberately conservative (high)
 * per the #859 framing — "merge only what GENUINELY overlaps; keep distinct
 * memories distinct". A lower bar would over-merge unrelated memories that
 * merely share a few common words (e.g. two different facts both mentioning
 * "facilities").
 */
export const MEMORY_MERGE_THRESHOLD = 0.3;

/**
 * Merge new content into an existing note body: appends the new content as an
 * additional line UNLESS it is already substantially contained in the
 * existing body (a plain substring check on the normalized text, mirroring
 * `skill_consolidation_drafter.ts`'s "already contained" guard) — so re-
 * remembering the exact same sentence twice does not pad the note with
 * duplicate lines, but a genuinely new nuance is preserved.
 */
export function mergeMemoryContent(existingBody: string, newContent: string): string {
  const existing = existingBody.trim();
  const incoming = newContent.trim();
  if (incoming === '') return existing;
  if (existing === '') return incoming;
  if (existing.toLowerCase().includes(incoming.toLowerCase())) return existing;
  return `${existing}\n\n${incoming}`;
}

export interface AttributedMemoryPart {
  body: string;
  sources?: MemorySource[];
  usageWindow?: MemoryUsageWindow;
}

export interface AttributedMemoryMergeResult {
  body: string;
  sources: MemorySource[];
  usageWindow?: MemoryUsageWindow;
}

export class MemoryAttributionMergeError extends Error {
  constructor(side: 'survivor' | 'incoming', reason: string) {
    super(`${side} attribution is unsafe to merge: ${reason}`);
    this.name = 'MemoryAttributionMergeError';
  }
}

function nextSourceId(
  base: string,
  reserved: Set<string>,
): string {
  let suffix = 2;
  let candidate = `${base}-${suffix}`;
  while (reserved.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  reserved.add(candidate);
  return candidate;
}

function rewriteFootnoteIds(
  body: string,
  replacements: Map<string, string>,
): string {
  if (replacements.size === 0) return body;
  return body.replace(
    /\[\^([A-Za-z0-9_-]+)\]/g,
    (marker, id: string) => {
      const replacement = replacements.get(id);
      return replacement ? `[^${replacement}]` : marker;
    },
  );
}

function widestUsageWindow(
  survivor?: MemoryUsageWindow,
  incoming?: MemoryUsageWindow,
): MemoryUsageWindow | undefined {
  const existing = memoryUsageWindow({ usage_window: survivor });
  const added = memoryUsageWindow({ usage_window: incoming });
  const from = [existing?.from, added?.from]
    .filter((value): value is string => typeof value === 'string')
    .sort()[0];
  const to = [existing?.to, added?.to]
    .filter((value): value is string => typeof value === 'string')
    .sort()
    .at(-1);
  const merged = { ...added, ...existing };
  if (from) merged.from = from;
  else delete merged.from;
  if (to) merged.to = to;
  else delete merged.to;
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function assertAttributionSafe(
  side: 'survivor' | 'incoming',
  part: AttributedMemoryPart,
): MemorySource[] {
  const sources = memorySources({ sources: part.sources });
  const invalidIds = sources
    .map(({ id }) => id)
    .filter((id) => !MEMORY_SOURCE_ID_PATTERN.test(id));
  if (invalidIds.length > 0) {
    throw new MemoryAttributionMergeError(side, 'invalid source id');
  }
  const validation = validateNoteSources({ body: part.body, sources });
  if (validation.danglingFootnoteReferences.length > 0) {
    throw new MemoryAttributionMergeError(
      side,
      'dangling footnote reference',
    );
  }
  if (isReversedMemoryUsageWindow(part.usageWindow)) {
    throw new MemoryAttributionMergeError(side, 'reversed usage window');
  }
  return sources;
}

/**
 * Merge a folded-in note's attribution alongside its body.
 *
 * The survivor wins ordinary metadata conflicts. If the same note-local id
 * names two different resources, the incoming source is rekeyed and only the
 * incoming body's markers are rewritten before content is appended.
 */
export function mergeAttributedMemoryContent(
  survivor: AttributedMemoryPart,
  incoming: AttributedMemoryPart,
): AttributedMemoryMergeResult {
  const sources = assertAttributionSafe('survivor', survivor);
  const incomingSources = assertAttributionSafe('incoming', incoming);
  const byId = new Map(sources.map((source) => [source.id, source]));
  const reserved = new Set([
    ...sources.map(({ id }) => id),
    ...incomingSources.map(({ id }) => id),
  ]);
  const replacements = new Map<string, string>();

  for (const source of incomingSources) {
    const existing = byId.get(source.id);
    if (!existing) {
      const copy = { ...source };
      sources.push(copy);
      byId.set(copy.id, copy);
      continue;
    }

    const survivorResource = typeof existing.resource === 'string'
      ? existing.resource
      : undefined;
    const incomingResource = typeof source.resource === 'string'
      ? source.resource
      : undefined;
    if (survivorResource !== incomingResource) {
      const rekeyedId = nextSourceId(source.id, reserved);
      const rekeyed = { ...source, id: rekeyedId };
      sources.push(rekeyed);
      byId.set(rekeyedId, rekeyed);
      replacements.set(source.id, rekeyedId);
      logger.warn(
        `[MemoryMerge] source id collision rekeyed incoming ${source.id} as ${rekeyedId}`,
      );
      continue;
    }

    if (!isDeepStrictEqual(existing, source)) {
      logger.warn(
        `[MemoryMerge] source metadata conflict for ${source.id}; survivor entry retained`,
      );
    }
  }

  const rewrittenIncoming = rewriteFootnoteIds(incoming.body, replacements);
  const body = mergeMemoryContent(survivor.body, rewrittenIncoming);
  const mergedValidation = validateNoteSources({ body, sources });
  if (mergedValidation.danglingFootnoteReferences.length > 0) {
    throw new MemoryAttributionMergeError(
      'incoming',
      'merged result has a dangling footnote reference',
    );
  }
  return {
    body,
    sources,
    usageWindow: widestUsageWindow(
      survivor.usageWindow,
      incoming.usageWindow,
    ),
  };
}
