/**
 * skill_consolidation_drafter.ts — #852 (org-optimizer-18)
 *
 * `scope_hygiene_generator.ts` (#822) emits `consolidate-skill` proposals
 * carrying only the *pairing* signal —
 * `{skillIdA, skillIdB, titleA, titleB, similarity}` — no drafted body. That
 * shape is not a `BodyRefinementChange` (`{priorBody, revisedBody, ...}`), so
 * `org_proposal_measure.ts`'s `isBodyRefinementChange()` guard returns false
 * for it and `measureBodyRefinement` resolves to `'skipped'`, leaving the row
 * parked in `status='measuring'` forever (see that generator's doc comment,
 * "APPLY-SIDE WIRING NOTE"). This module is the missing body-drafting step:
 * given the two source skills, it mechanically merges their bodies and
 * reshapes `change_json` into the `BodyRefinementChange` shape the measure
 * step already knows how to score.
 *
 * MERGE STRATEGY (v1, deliberately mechanical — no LLM call):
 *   1. Parse each body into an ordered list of sections, where a "section"
 *      is a `##`-level (or higher) markdown heading plus everything under it
 *      up to the next heading of the same or shallower level. Any leading
 *      content before the first heading (typically the `# Title` line) is
 *      kept as a preamble, not treated as a section.
 *   2. Concatenate: walk skill A's sections in order, then skill B's.
 *   3. Dedup by heading text (case-insensitive, trimmed): the FIRST body to
 *      contribute a heading wins that heading's slot, but if the SECOND
 *      body's content under the same heading is not already contained in the
 *      first (byte-for-byte substring check), its non-duplicate content is
 *      appended under that same heading rather than dropped — so the merge
 *      never silently loses one side's steps, it just avoids repeating the
 *      literal heading line.
 *   4. Bodies with no headings at all (a single paragraph) are folded in
 *      under a synthesized `## From <title>` heading so nothing is lost.
 *
 * This is intentionally simple (concatenate + dedup section headers, per the
 * #852 acceptance criteria's explicit "v1 acceptable" language) — no attempt
 * is made to semantically de-duplicate PROSE within a section (e.g. two
 * near-identical sentences); that would require an LLM pass and is left as a
 * documented future improvement, not built here.
 *
 * Operational envelope (mirrors the rest of the org-optimizer services):
 *   • Pure/deterministic — no IO, no LLM call. Safe to run inline in the
 *     measure/apply path without an injectable dependency.
 *   • NEVER throws on well-formed string input (worst case: an empty or
 *     near-empty merged body, never an exception).
 */

import type { AgentSkill } from '../models/agent_skill';

/** Minimal shape this module needs from a "skill" — deliberately structural. */
export interface ConsolidationSkillInput {
  title: string;
  body: string | null;
}

interface Section {
  /** Normalized (trimmed, case-folded) heading text used for dedup matching. */
  key: string;
  /** The heading line verbatim (e.g. "## Steps"), or null for the preamble. */
  headingLine: string | null;
  /** Body content under the heading (or the whole preamble), trimmed. */
  content: string;
}

/**
 * Split a markdown body into an ordered preamble + section list. A section
 * starts at any line matching `##`+ (level 2 or deeper) heading syntax; the
 * top-level `# Title` line (if present) is folded into the preamble so it
 * never collides with a real "##..." section during dedup.
 */
function splitIntoSections(body: string): Section[] {
  const lines = (body ?? '').split('\n');
  const sections: Section[] = [];
  let current: { headingLine: string | null; buffer: string[] } = {
    headingLine: null,
    buffer: [],
  };

  const flush = () => {
    const content = current.buffer.join('\n').trim();
    if (content !== '' || current.headingLine !== null) {
      sections.push({
        key: current.headingLine ? normalizeHeading(current.headingLine) : '__preamble__',
        headingLine: current.headingLine,
        content,
      });
    }
  };

  const headingRe = /^(#{2,6})\s+(.*)$/;
  for (const line of lines) {
    const match = headingRe.exec(line);
    if (match) {
      flush();
      current = { headingLine: line.trim(), buffer: [] };
    } else {
      current.buffer.push(line);
    }
  }
  flush();

  return sections;
}

function normalizeHeading(headingLine: string): string {
  return headingLine.replace(/^#{2,6}\s*/, '').trim().toLowerCase();
}

/**
 * Mechanically merge two skill bodies: concatenate their sections in order
 * (A's preamble/title, then A's sections, then B's non-preamble sections),
 * deduping by heading text. When both sides share a heading, the surviving
 * section keeps A's heading line and appends any of B's content under it
 * that A's content does not already contain (a plain substring check — no
 * semantic dedup). A body with no headings at all is folded in as a
 * `## From <title>` section so its content is never dropped.
 *
 * Deterministic, pure, and NEVER throws on string input.
 */
export function draftConsolidatedSkillBody(
  a: ConsolidationSkillInput,
  b: ConsolidationSkillInput,
): string {
  const bodyA = a.body ?? '';
  const bodyB = b.body ?? '';

  const sectionsA = splitIntoSections(bodyA);
  const rawSectionsB = splitIntoSections(bodyB);
  // B's preamble (its own "# Title" line, if any) is not meaningful once
  // merged under A's title — fold any headless B content into a synthesized
  // heading instead of silently dropping it.
  const sectionsB = rawSectionsB.map((s) =>
    s.key === '__preamble__' && s.content !== ''
      ? { key: normalizeHeading(`## From ${b.title}`), headingLine: `## From ${b.title}`, content: s.content }
      : s,
  );

  const merged: Section[] = [];
  const indexByKey = new Map<string, number>();

  const contribute = (section: Section) => {
    if (section.key === '__preamble__' && section.content === '') return;
    const existingIdx = indexByKey.get(section.key);
    if (existingIdx === undefined) {
      indexByKey.set(section.key, merged.length);
      merged.push({ ...section });
      return;
    }
    // Same heading already present — append non-duplicate content only.
    const existing = merged[existingIdx];
    if (section.content !== '' && !existing.content.includes(section.content)) {
      existing.content = existing.content ? `${existing.content}\n\n${section.content}` : section.content;
    }
  };

  for (const section of sectionsA) contribute(section);
  for (const section of sectionsB) contribute(section);

  if (merged.length === 0) return '';

  const parts: string[] = [];
  for (const section of merged) {
    if (section.headingLine) {
      parts.push(section.headingLine);
      if (section.content) parts.push('', section.content);
      parts.push('');
    } else if (section.content) {
      parts.push(section.content, '');
    }
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** The BodyRefinementChange shape org_proposal_measure.ts recognizes (mirrored here to avoid a cross-import). */
export interface DraftedConsolidationChange {
  skillName: string;
  priorBody: string;
  revisedBody: string;
  description?: string | null;
}

/**
 * Build the `change_json` payload for a consolidate-skill proposal once
 * drafted: `priorBody` is skill A's current body (the baseline the merge
 * must beat), `revisedBody` is the mechanically merged body. `skillName` is
 * set to skill A's title — skill A is the SURVIVOR the merged body is
 * written onto; skill B is the one retired on a 'kept' outcome (see
 * `applyConsolidateSkill` in org_proposal_apply.ts). Deliberately excludes
 * any `add`/`allowed_delegates_json`/`insertAgentConfig`/
 * `createWebhookEndpoint` key so `org_risk_classifier.changeShapeIsHardRuledHigh`
 * never escalates a drafted consolidate-skill proposal to 'high' (#852-c5).
 */
export function draftConsolidationChangeJson(
  a: Pick<AgentSkill, 'title' | 'body'>,
  b: Pick<AgentSkill, 'title' | 'body'>,
): string {
  const change: DraftedConsolidationChange = {
    skillName: a.title,
    priorBody: a.body ?? '',
    revisedBody: draftConsolidatedSkillBody(
      { title: a.title, body: a.body },
      { title: b.title, body: b.body },
    ),
    description: `Consolidated with '${b.title}'`,
  };
  return JSON.stringify(change);
}

/** The original scope_hygiene_generator consolidate-skill pairing payload. */
export interface ConsolidationPairingChange {
  skillIdA: string;
  skillIdB: string;
  titleA: string;
  titleB: string;
  similarity: number;
}

export function isConsolidationPairingChange(v: unknown): v is ConsolidationPairingChange {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c.skillIdA === 'string' && typeof c.skillIdB === 'string';
}

/**
 * Extra metadata the apply/revert step needs beyond the BodyRefinementChange
 * shape (which only records the SURVIVOR's prior/revised body): the
 * RETIRED skill's id, title, prior body, and prior status, so a revert can
 * restore it exactly. Carried in `change_json` alongside the
 * BodyRefinementChange fields (org_proposal_measure.ts only reads
 * `priorBody`/`revisedBody`/`skillName`/`description` off this same object
 * and ignores the rest, so this is additive, not a shape conflict).
 */
export interface DraftedConsolidationPayload extends DraftedConsolidationChange {
  survivorSkillId: string;
  retiredSkillId: string;
  retiredTitle: string;
  retiredPriorBody: string | null;
  retiredPriorStatus: string;
}

/**
 * Draft the full consolidate-skill apply payload from the two live skill
 * rows. `survivor` is the skill the merged body is written onto (kept
 * alive under its own name); `retired` is marked non-published on a 'kept'
 * outcome. Returns `null` (drafting is impossible — e.g. one of the ids no
 * longer resolves to a live skill) rather than throwing; callers treat that
 * as "cannot draft yet" and leave the proposal for a later pass.
 */
export function draftConsolidationPayload(
  survivor: AgentSkill,
  retired: AgentSkill,
): DraftedConsolidationPayload {
  const revisedBody = draftConsolidatedSkillBody(
    { title: survivor.title, body: survivor.body },
    { title: retired.title, body: retired.body },
  );
  return {
    skillName: survivor.title,
    priorBody: survivor.body ?? '',
    revisedBody,
    description: `Consolidated with '${retired.title}'`,
    survivorSkillId: survivor.id,
    retiredSkillId: retired.id,
    retiredTitle: retired.title,
    retiredPriorBody: retired.body ?? null,
    retiredPriorStatus: retired.status,
  };
}
