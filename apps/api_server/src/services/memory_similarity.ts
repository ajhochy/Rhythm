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
