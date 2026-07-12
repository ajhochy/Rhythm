/**
 * skill_extractor.ts — P2-1
 *
 * Background auto-extraction of a DRAFT skill from a rich agent session.
 * Mirrors Odysseus `services/memory/skill_extractor.py`: when an agent run was
 * non-trivial (>= 2 rounds), ask a cheap LLM to distill the approach into a
 * reusable computer procedure and persist it to the shared agent_skills store
 * as a `draft` for later human review.
 *
 * Design constraints (see issue P2-1):
 *  • isTestEnv() short-circuits to null with ZERO LLM/DB side effects (mirrors
 *    opencode_agent_writer.ts isTestEnv VERBATIM). This is proven by a test.
 *  • Postgres (env.dbClient === 'postgres') is a no-op — agent data is
 *    local-SQLite-only, never synced to production.
 *  • NEVER throws — the P2-2 caller is fire-and-forget and depends on this.
 *  • Conservative: confidence floor 0.6, dedup by title, null for non-reusable.
 *  • Shared skills (no owner scoping).
 *
 * OQ-3 (rounds/tools signal): agent_session_messages stores plain role+text
 * rows (role ∈ 'input' | 'output' | 'system') — the base schema has no
 * structured tool-call parts. So "non-trivial" is derived from ROUND COUNT =
 * number of assistant ('output') messages in the recent window; we qualify when
 * rounds >= 2. The tool-call granularity from Odysseus is NOT available here, so
 * the signal is degraded to round-count-only (acceptable per the issue).
 *
 * OQ-4 (model): the default LLM call reuses AgentRunner's resolveRunModel() so
 * extraction rides the same model-selection path as a real run (agent config →
 * MRU → hardcoded default). No vendor model id is hardcoded here beyond what
 * resolveRunModel returns. This is a cheap background distill, so we omit any
 * agentConfigId and let resolveRunModel fall through to the MRU/default tier.
 */

import { logger } from '../utils/logger';
import { env } from '../config/env';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { refineExistingSkill, type RefineCandidate } from './skill_refiner';
import { tryAutoWireLibrarySkill } from './skill_reuse';
import { AgentCapabilityGapsRepository } from '../repositories/agent_capability_gaps_repository';
import {
  draftSkillExists,
  managedSkillsRoot,
  writeDraftManagedSkill,
} from './rhythm_managed_skills';
import type { AgentSkill } from '../models/agent_skill';

/**
 * Never run the extractor (LLM call OR DB write) from a test run. vitest seeds
 * sessions/messages with throwaway fixtures; without this guard the default
 * llmCall would hit a real model and the repo would persist junk drafts.
 * Mirrors opencode_agent_writer.ts isTestEnv() VERBATIM.
 */
function isTestEnv(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

// ── Background status tracking ────────────────────────────────────────────────
// Lightweight in-memory counters updated on each extract/refine run so the
// /agent-sessions/background-status endpoint can report curator state cheaply
// without hitting the DB or LLM.
let _curatorExtractLastAt: string | null = null;
let _curatorExtractRunning = false;

// ── Curator throttle: defer work during engine cold-start window (#746) ───────
// When the engine was just initialized (< CURATOR_COLD_WINDOW_MS ago), background
// skill extraction contends with the first interactive session setup. Defer all
// curator work during this window to keep the interactive path fast.
const CURATOR_COLD_WINDOW_MS = 90_000; // 90 seconds after engine init
let _engineReadyAt: number | null = null;

/**
 * #746 — Called by OpencodeClientService once the engine is ready. Records the
 * timestamp so queueSkillExtraction can gate curator work outside the cold window.
 */
export function notifyEngineReady(readyAt: number): void {
  _engineReadyAt = readyAt;
}

/**
 * #746 — Returns true when the engine is still in its cold-start window and
 * curator work should be deferred. False when enough time has passed (or when
 * the engine has never been initialized — queueSkillExtraction's isTestEnv
 * guard already no-ops under test without needing this).
 */
function isCuratorThrottled(): boolean {
  if (_engineReadyAt === null) return false;
  return Date.now() - _engineReadyAt < CURATOR_COLD_WINDOW_MS;
}

/**
 * #746 / #850 — Public alias of {@link isCuratorThrottled}, exported so other
 * background subsystems that must respect the SAME engine cold-start window
 * (e.g. the org self-optimizer's run-loop, org_optimizer_run_service.ts) can
 * gate on it without duplicating the 90s constant or the readiness timestamp.
 * Semantics are identical: false (never throttled) when the engine has never
 * been initialized, true for 90s after `notifyEngineReady` was last called.
 */
export function isEngineColdStart(): boolean {
  return isCuratorThrottled();
}

/**
 * Test-only reset of the module-level `_engineReadyAt` timestamp back to
 * "never initialized" (isEngineColdStart() -> false). Needed because
 * `notifyEngineReady` mutates module state that otherwise leaks across test
 * cases sharing this module within one vitest worker/file.
 */
export function _resetEngineReadyForTests(): void {
  _engineReadyAt = null;
}

/** Update extract-run tracking. Called by distillFromSession start/end. */
export function _setCuratorExtractRunning(running: boolean, at?: string): void {
  _curatorExtractRunning = running;
  if (at) _curatorExtractLastAt = at;
}

/** Return lightweight curator status for the background-status endpoint. */
export function getCuratorExtractStatus(): { running: boolean; lastRunAt: string | null } {
  return { running: _curatorExtractRunning, lastRunAt: _curatorExtractLastAt };
}

/** How many recent messages to include (Odysseus CONTEXT_WINDOW). */
const CONTEXT_WINDOW = 12;

const KNOWN_CONTEXT_PREFACE_HEADER = '## Known context (facts & preferences)';

/**
 * ws_gateway prepends the transient memory preface as:
 *   <header>\n- <memory>\n\n<forwarded user text>
 * Strip only that leading injected block; a later/user-authored mention of the
 * heading is left intact.
 */
function stripKnownContextPreface(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let headerIdx = 0;
  while (headerIdx < lines.length && lines[headerIdx].trim() === '') {
    headerIdx++;
  }
  if (lines[headerIdx] !== KNOWN_CONTEXT_PREFACE_HEADER) return text;
  if (!lines[headerIdx + 1]?.startsWith('- ')) return text;

  const separatorIdx = lines.findIndex((line, idx) => idx > headerIdx && line.trim() === '');
  if (separatorIdx === -1) return '';
  return lines.slice(separatorIdx + 1).join('\n');
}

/**
 * Skills the model is unsure about (or that read as one-offs) add clutter —
 * drop anything below this confidence (Odysseus MIN_CONFIDENCE).
 */
const MIN_CONFIDENCE = 0.6;

/** System prompt — distill a reusable computer procedure (Odysseus wording). */
function buildSystemPrompt(rounds: number): string {
  return (
    `You are analyzing an AI agent's work session. The agent took ${rounds} rounds ` +
    `to complete the task.\n\n` +
    "Extract a reusable 'skill' ONLY IF the session contains a concrete, " +
    'repeatable procedure the agent could follow to solve a similar problem ' +
    'ON THE COMPUTER next time (e.g. a sequence of shell commands, code, file ' +
    'edits, API calls, or tool usage).\n\n' +
    'Return null (the bare word, no JSON) when the session is NOT a reusable ' +
    'computer procedure, including:\n' +
    '- The real work happened OUTSIDE the computer (the user did something ' +
    'physically, in person, on another device, or by hand) and the agent only ' +
    'discussed or advised it.\n' +
    '- A one-off, personal, or context-specific task that won\'t recur ' +
    '(personal errands, a specific person/place/date, casual conversation).\n' +
    '- A pure question/answer or explanation with no transferable method.\n' +
    '- The agent failed, gave up, or the approach is not worth repeating.\n\n' +
    'When (and only when) a genuine reusable procedure exists, return a JSON ' +
    'object with:\n' +
    '- "title": short name (under 10 words)\n' +
    '- "problem": what was the challenge (1-2 sentences)\n' +
    '- "solution": what worked (1-2 sentences)\n' +
    '- "steps": array of step-by-step instructions (3-7 short steps)\n' +
    '- "tags": array of relevant keywords (3-5 tags)\n' +
    '- "confidence": 0.0-1.0 how reliable AND reusable this procedure is\n\n' +
    'Be conservative: if in doubt, return null.\n' +
    'Return ONLY valid JSON (or the bare word null), no markdown fences.'
  );
}

/**
 * Best-effort extraction of a single top-level JSON object from an LLM response.
 * Mirrors Odysseus `_extract_json_object`: tolerant of code fences and
 * surrounding prose; if multiple non-overlapping top-level objects are found
 * it's treated as ambiguous and returns null.
 */
function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  let s = text.trim();
  if (s.startsWith('```')) {
    // Strip a leading ```lang fence line and a trailing ``` fence.
    const nl = s.indexOf('\n');
    if (nl !== -1) s = s.slice(nl + 1);
    const lastFence = s.lastIndexOf('```');
    if (lastFence !== -1) s = s.slice(0, lastFence);
    s = s.trim();
  }

  const candidates: Array<{ start: number; end: number; obj: Record<string, unknown> }> = [];
  let start = s.indexOf('{');
  while (start !== -1) {
    // raw_decode equivalent: try to parse the largest prefix that is valid JSON
    // by scanning balanced braces from `start`.
    const end = matchingBrace(s, start);
    if (end !== -1) {
      const slice = s.slice(start, end + 1);
      try {
        const obj = JSON.parse(slice);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          candidates.push({ start, end, obj: obj as Record<string, unknown> });
        }
      } catch {
        /* not a valid object at this position — skip */
      }
    }
    start = s.indexOf('{', start + 1);
  }

  // Filter out nested candidates to keep only top-level objects.
  const topLevel = candidates.filter(
    (c) => !candidates.some((o) => o !== c && o.start <= c.start && c.end <= o.end),
  );

  if (topLevel.length === 0) return null;
  if (topLevel.length > 1) {
    logger.info('[skill-extract] multiple top-level JSON objects found — ambiguous, dropping');
    return null;
  }
  return topLevel[0].obj;
}

/** Index of the brace matching the `{` at `open`, or -1 if unbalanced. */
function matchingBrace(s: string, open: number): number {
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Injectable LLM call: (systemPrompt, userContent, model?) => raw model text. */
export type LlmCall = (
  systemPrompt: string,
  userContent: string,
  model?: { providerID: string; modelID: string },
) => Promise<string>;

/**
 * Default (real) LLM call — thin + guarded. USO B5 (#1032): routes the distill
 * turn through AgentRunner.run() with category 'self_improvement' instead of a
 * bespoke opencodeClient.createSession + prompt, so the skill-extract loop shows
 * up as an observable self_improvement session (is_system=1, out of the default
 * Chats view). mcpRole 'skill-extract' + allowedMcpsJson '{}' builds the SAME
 * zero-MCP-tool config the old no-tool createSession had; run() applies
 * bypassPermissions internally (agent_runner._runOnce). Rides the extracting
 * session's own model when given (that provider just completed the turns being
 * distilled, so it is proven authed + live) via modelOverride; falls back to
 * resolveRunModel()'s MRU/default only when the session carries no model —
 * a global MRU can point at a provider that is unauthed here even though the
 * session itself ran fine (#949 live E2E). run() may prepend a transient
 * skills/memory preface to the PROMPT (input) when those toggles are on; that
 * never touches the model's OUTPUT, so extractJsonObject(res.result) is
 * unaffected. Lazy import keeps AgentRunner out of the module's hot path (and
 * out of test bundles, since this is never reached under isTestEnv).
 *
 * ── USO B5 (#1032) createSession audit — background-loop LLM routing ─────────
 * grep `opencodeClient.createSession` across apps/api_server/src (non-test):
 *   • skill_extractor.ts (this file, defaultLlmCall) — BACKGROUND LOOP → MIGRATED
 *       to run({category:'self_improvement'}) here.
 *   • harvested_skill_evaluator.ts (evaluateHarvestedDrafts) — NO createSession
 *       of its own; its LLM calls delegate to skill_refiner.scoreSkillBody /
 *       rewriteSkillBody. Nothing to migrate in this file (skill_refiner is a
 *       separate B-phase target).
 *   • skill_consolidation_drafter.ts / memory_consolidation_drafter.ts — the
 *       "consolidation drafters"; BOTH are deliberately MECHANICAL (documented
 *       "no LLM call") string merges. No createSession, no loop to migrate.
 *   • skill_refiner.ts (x3), generators/workflow_signal_generator.ts,
 *       org_proposal_measure.ts — other B-phase agents' background loops (owned
 *       elsewhere), out of this issue's file ownership.
 *   • agent_runner.ts:834 — run()'s OWN createSession. Legitimate, MUST stay.
 *   • ws_gateway.ts (x2), agent_sessions_controller.ts (x2) — the INTERACTIVE
 *       session-creation path (user-driven), NOT background loops. Kept as-is.
 */
const defaultLlmCall: LlmCall = async (systemPrompt, userContent, sessionModel) => {
  const { run, resolveRunModel } = await import('./agent_runner');
  const model = sessionModel ?? resolveRunModel();
  const combined = `${systemPrompt}\n\n${userContent}`;
  const res = await run({
    prompt: combined,
    sessionName: 'skill-extract',
    category: 'self_improvement',
    modelOverride: model,
    mcpRole: 'skill-extract',
    allowedMcpsJson: '{}',
  });
  // '' triggers the SAME fail path (LLM declined / no session) the old
  // no-session / empty-parts return used.
  return res.status === 'error' ? '' : res.result;
};

export interface DistillOptions {
  /** Injectable LLM call for tests; defaults to the real opencode-backed impl. */
  llmCall?: LlmCall;
  /**
   * P4-1: provenance label written to the drafted skill's frontmatter
   * `provenance`. Defaults to 'auto-extract' (the self-improvement loop). The
   * teacher-escalation path passes 'teacher-escalation' so a stronger model's
   * captured approach is distinguishable from ordinary auto-extraction.
   */
  source?: string;
}

// ── #949 helpers: harvest-to-file + auto-bind + reload ───────────────────────

/**
 * Derive a filesystem-safe, fork-matchable skill `name` from a distill title.
 * Lowercase, non-[a-z0-9-] runs collapsed to a single dash, dashes trimmed.
 * e.g. "Rebuild better-sqlite3 ABI" → "rebuild-better-sqlite3-abi".
 * The fork keys skills by frontmatter `name`; this slug is also what gets
 * appended to the extracting agent's allowedSkillsJson.
 */
function skillNameFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Render the draft SKILL.md body (markdown procedure). */
function renderDraftBody(title: string, description: string | null, steps: string[] | null): string {
  const lines: string[] = [`# ${title}`, ''];
  if (description && description.trim() !== '') {
    lines.push(description.trim(), '');
  }
  if (steps && steps.length > 0) {
    lines.push('## Steps', '');
    steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * #949 — Resolve the agent config id of the session that produced the draft,
 * mirroring the #818 attribution pattern: check `mcp_role` then `agent_kind`,
 * validating each against a real agent_configs row. Returns null when no
 * profile can be attributed (best-effort; never throws).
 */
function resolveExtractingAgentConfigId(sessionId: string): string | null {
  try {
    const sessions = new AgentSessionsRepository();
    const session = sessions.findById(sessionId);
    if (!session) return null;
    const configs = new AgentConfigsRepository();
    for (const candidate of [session.mcpRole, session.agentKind]) {
      if (typeof candidate !== 'string') continue;
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      if (configs.getById(trimmed)) return trimmed;
    }
  } catch (err) {
    logger.warn(`[skill-extract] agent config resolution failed for ${sessionId} (non-fatal): ${String(err)}`);
  }
  return null;
}

/**
 * #949 — Append the draft skill name to the extracting agent's
 * allowedSkillsJson. Skips (returns false) when the agent is unrestricted
 * (allowedSkillsJson === null) — the draft is already loadable to an
 * unrestricted agent and writing a single-element array would WRONGLY lock it
 * down to only the draft. Also skips when the name is already present or no
 * profile can be attributed to the session. Returns true when a bind was
 * written.
 */
async function autoBindDraftToExtractingAgent(sessionId: string, skillName: string): Promise<boolean> {
  const agentConfigId = resolveExtractingAgentConfigId(sessionId);
  if (!agentConfigId) return false;

  const configs = new AgentConfigsRepository();
  const config = configs.getById(agentConfigId);
  if (!config) return false;

  // null = unrestricted → draft already loadable; do NOT lock down.
  if (config.allowedSkillsJson === null) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(config.allowedSkillsJson);
  } catch {
    // Malformed existing value — leave it alone (normalize path will deny-all).
    return false;
  }
  if (!Array.isArray(parsed)) return false;

  const skills = parsed.filter((e): e is string => typeof e === 'string' && e.trim().length > 0);
  const cleanName = skillName.trim();
  if (!cleanName) return false;
  if (skills.includes(cleanName)) return false; // already bound

  skills.push(cleanName);
  configs.update(agentConfigId, { allowedSkillsJson: JSON.stringify(skills) });
  return true;
}

/**
 * #949 — Fire-and-forget trigger of the engine's skill reload so a freshly-
 * written draft is discoverable without a restart. Reuses the Unify-2
 * OpencodeClientService.reloadSkills pattern. Lazy-imported to keep the
 * extractor's hot path free of the opencode client. Never throws.
 */
async function triggerSkillReload(): Promise<void> {
  try {
    const { opencodeClient } = await import('./opencode_engine');
    // The fork's /skill/reload `directory` param keys the ENGINE INSTANCE
    // (per-directory InstanceState = session cwd), NOT the skills path.
    // Passing managedSkillsRoot() invalidated an instance no session runs in,
    // so fresh drafts stayed invisible until an unrelated /system/refresh.
    // Argless = homedir(), the instance sessions actually use (#949 live).
    await opencodeClient.reloadSkills();
  } catch (err) {
    // Non-fatal: the draft file exists on disk and will be discovered on next
    // engine restart even if this reload fails.
    logger.warn(`[skill-extract] skill reload failed (non-fatal): ${String(err)}`);
  }
}

/**
 * Distill a DRAFT skill from a session's recent messages. Returns the created
 * AgentSkill on success, or null in every other case (test env, postgres, too
 * few rounds, model declined, low confidence, duplicate title, any error).
 *
 * NEVER throws.
 */
export async function distillFromSession(
  sessionId: string,
  opts?: DistillOptions,
): Promise<AgentSkill | null> {
  // Hard guard: zero LLM/DB side effects under test. Mirrors opencode_agent_writer.
  if (isTestEnv()) {
    return null;
  }
  // Local-agent only — never extract on the production Postgres path.
  if (env.dbClient === 'postgres') {
    return null;
  }

  const llmCall = opts?.llmCall ?? defaultLlmCall;
  const source = opts?.source ?? 'auto-extract';

  _setCuratorExtractRunning(true, new Date().toISOString());
  try {
    const msgRepo = new AgentSessionMessagesRepository();
    const all = msgRepo.listBySession(sessionId, 200);
    const recent = all.length > CONTEXT_WINDOW ? all.slice(-CONTEXT_WINDOW) : all;

    // Strip non-text/empty rows; count rounds = assistant ('output') messages.
    const stripped = recent.filter((m) => {
      const text = (m.strippedText ?? m.rawText ?? '').trim();
      return text.length > 0;
    });
    if (stripped.length === 0) {
      logger.info('[skill-extract] no recent text messages — skipping');
      return null;
    }

    const rounds = stripped.filter((m) => m.role === 'output').length;
    if (rounds < 2) {
      logger.info(`[skill-extract] below threshold (rounds=${rounds} < 2) — skipping`);
      return null;
    }

    // Build a compact conversation transcript (truncate long messages).
    const conversation = stripped
      .map((m) => {
        let content = (m.strippedText ?? m.rawText ?? '').trim();
        if (m.role === 'input') {
          content = stripKnownContextPreface(content).trim();
        }
        if (!content) return null;
        if (content.length > 500) content = content.slice(0, 500) + '...';
        return `[${m.role}] ${content}`;
      })
      .filter((line): line is string => line !== null)
      .join('\n');

    const systemPrompt = buildSystemPrompt(rounds);
    const userContent = `Conversation:\n${conversation}`;

    // Prefer the extracting session's own (bridge-backfilled) model — the
    // provider that just produced the rounds being distilled.
    let sessionModel: { providerID: string; modelID: string } | undefined;
    try {
      const sess = new AgentSessionsRepository().findById(sessionId);
      if (sess?.providerId && sess?.modelId) {
        sessionModel = { providerID: sess.providerId, modelID: sess.modelId };
      }
    } catch {
      // non-fatal — fall back to defaultLlmCall's own resolution
    }

    let response: string;
    try {
      response = await llmCall(systemPrompt, userContent, sessionModel);
    } catch (err) {
      logger.warn(`[skill-extract] LLM call failed (non-fatal): ${String(err)}`);
      return null;
    }

    if (!response || response.trim().toLowerCase() === 'null') {
      logger.info('[skill-extract] LLM declined (null/empty) — not a reusable procedure');
      return null;
    }

    const data = extractJsonObject(response);
    if (!data) {
      logger.info('[skill-extract] no JSON object parsed from response — dropping');
      return null;
    }

    const title = typeof data.title === 'string' ? data.title.trim() : '';
    if (!title) {
      logger.info('[skill-extract] parsed object has no title — dropping');
      return null;
    }

    let confidence = 0.7;
    const rawConf = data.confidence;
    if (typeof rawConf === 'number' && Number.isFinite(rawConf)) {
      confidence = rawConf;
    } else if (typeof rawConf === 'string' && rawConf.trim() !== '' && Number.isFinite(Number(rawConf))) {
      confidence = Number(rawConf);
    }
    if (confidence < MIN_CONFIDENCE) {
      logger.info(
        `[skill-extract] '${title}' below confidence floor (${confidence} < ${MIN_CONFIDENCE}) — dropped`,
      );
      return null;
    }

    const repo = new AgentSkillsRepository();

    const problem = typeof data.problem === 'string' ? data.problem.trim() : '';
    const solution = typeof data.solution === 'string' ? data.solution.trim() : '';
    const description = [problem, solution].filter((s) => s.length > 0).join('\n\n') || solution || null;

    const steps = Array.isArray(data.steps)
      ? (data.steps.filter((s) => typeof s === 'string') as string[])
      : null;
    const tags = Array.isArray(data.tags)
      ? (data.tags.filter((t) => typeof t === 'string') as string[])
      : null;

    // P5-2 — self-refinement: if this candidate matches an EXISTING skill, try
    // to improve it IN PLACE (quality-bar gated, auto-applied, non-destructive)
    // rather than skipping the dup or creating a parallel draft. The refiner
    // maps the distill `source` to the corresponding refinement provenance.
    const refineSource = source === 'teacher-escalation' ? 'teacher-refined' : 'auto-refined';
    const outcome = await refineExistingSkill(
      { title, description, steps, tags, confidence },
      { repo, source: refineSource },
    );
    if (outcome === 'revised') {
      // Existing skill improved in place — do NOT also create a new draft.
      return null;
    }
    if (outcome === 'kept' || outcome === 'skipped') {
      // A match exists but the quality bar failed (or refinement is off). Keep
      // the legacy dup behavior: if the TITLE already exists, do not duplicate.
      if (repo.findByTitle(title)) {
        logger.info(`[skill-extract] '${title}' already exists — dup skipped`);
        return null;
      }
    }
    // 'no-match' (or kept/skipped with no title clash) → fall through to draft.

    // ── Stage A step 2: reuse an existing LIBRARY skill (auto-wire) ───────────
    // Before drafting a fresh (usually weaker) skill, check the OWNED library
    // (managedSkillsRoot() files) for a skill that adequately covers this intent
    // that the extracting agent isn't wired to yet. If found, wire it and STOP —
    // no bespoke draft. Reversible: tryAutoWireLibrarySkill snapshots the prior
    // allowlist. Never throws.
    const intentCandidate: RefineCandidate = {
      title,
      description,
      whenToUse: null,
      steps,
      tags,
      confidence,
    };
    try {
      const wired = await tryAutoWireLibrarySkill(sessionId, intentCandidate);
      if (wired) {
        logger.info(
          `[skill-extract] '${title}' covered by library skill '${wired.skillName}' — auto-wired, no draft`,
        );
        _setCuratorExtractRunning(false);
        return null;
      }
    } catch (wireErr) {
      // Non-fatal — fall through to drafting.
      logger.warn(`[skill-extract] auto-wire attempt failed for '${title}' (non-fatal): ${String(wireErr)}`);
    }

    // ── Stage A step 3: no adequate library match → record a capability-gap ───
    // (Plan A↔Plan B shared contract.) Eager, dedup'd insert-if-absent so the
    // next org-optimizer run can drive external discovery. Emitting here (before
    // the draft write) makes the gap independent of draft-write success. Never
    // throws; a failed gap insert must not block the draft below.
    try {
      await new AgentCapabilityGapsRepository().insertIfAbsentAsync({
        intentTitle: title,
        intentProblem: problem || null,
        intentTags: tags,
        sampleSessionId: sessionId,
        agentConfigId: resolveExtractingAgentConfigId(sessionId),
      });
    } catch (gapErr) {
      logger.warn(`[skill-extract] capability-gap emit failed for '${title}' (non-fatal): ${String(gapErr)}`);
    }

    // #949 — Harvest directly to a draft SKILL.md file under the Rhythm-managed
    // skills drafts namespace (instead of a DB row). The engine scans the
    // managed dir, so the draft is immediately discoverable by GET /opencode/skills
    // and visible in the Flutter Skills UI. See decision doc
    // 2026-07-08-harvest-to-file-autobind.md.
    const skillName = skillNameFromTitle(title);
    if (draftSkillExists(skillName)) {
      logger.info(`[skill-extract] draft '${skillName}' already exists on disk — dup skipped`);
      return null;
    }

    const body = renderDraftBody(title, description, steps);
    const extractedAt = new Date().toISOString();
    let draftLocation: string;
    try {
      draftLocation = writeDraftManagedSkill({
        name: skillName,
        description: description ?? title,
        body,
        sourceSessionId: sessionId,
        confidence,
        provenance: source,
        extractedAt,
      });
    } catch (writeErr) {
      // ContextInjectionBlockedError, InvalidSkillNameError, or fs error.
      logger.warn(`[skill-extract] draft write failed for '${skillName}' (non-fatal): ${String(writeErr)}`);
      _setCuratorExtractRunning(false);
      return null;
    }
    logger.info(`[skill-extract] drafted skill '${skillName}' at ${draftLocation}`);

    // #949 — Auto-bind the draft to the agent whose session produced it, so it
    // gets exercised in that agent's next real session before human review.
    // Skip silently when the agent is unrestricted (allowedSkillsJson === null)
    // — the draft is already loadable to an unrestricted agent, and writing a
    // single-element array would WRONGLY lock it down to only the draft.
    try {
      const bound = await autoBindDraftToExtractingAgent(sessionId, skillName);
      if (bound) {
        logger.info(`[skill-extract] auto-bound draft '${skillName}' to extracting agent`);
      }
    } catch (bindErr) {
      // Non-fatal: the draft file exists and is loadable regardless of binding.
      logger.warn(`[skill-extract] auto-bind failed for '${skillName}' (non-fatal): ${String(bindErr)}`);
    }

    // #949 — Trigger a skill reload so the engine picks up the new draft file
    // without a restart. Reuses the Unify-2 reloadSkills pattern. Fire-and-
    // forget: the draft is already on disk; reload just makes it visible sooner.
    void triggerSkillReload();

    _setCuratorExtractRunning(false);
    return {
      id: skillName,
      title,
      whenToUse: null,
      description,
      steps,
      tags,
      stepsJson: steps ? JSON.stringify(steps) : null,
      tagsJson: tags ? JSON.stringify(tags) : null,
      body: null,
      confidence,
      status: 'draft',
      source: 'harvested',
      uses: 0,
      version: 1,
      appliedForName: null,
      baseVersion: null,
      originLocation: draftLocation,
      isExternal: 0,
      baselineScore: null,
      postScore: null,
      measureReason: null,
      createdAt: extractedAt,
      updatedAt: extractedAt,
    };
  } catch (err) {
    // NEVER throw — fire-and-forget caller (P2-2) depends on this.
    logger.warn(`[skill-extract] FAILED (non-fatal): ${String(err)}`);
    _setCuratorExtractRunning(false);
    return null;
  }
}

/** Minimum assistant ('output') rounds before a session is worth distilling. */
const MIN_ROUNDS = 2;

/**
 * Injectable distill function for {@link queueSkillExtraction}. Defaults to the
 * real {@link distillFromSession}. Tests can override via the second arg to
 * observe calls / inject a slow or throwing implementation without a real LLM.
 */
export type DistillFn = (sessionId: string) => Promise<AgentSkill | null>;

/**
 * P2-2 — Fire-and-forget queue for background skill extraction.
 *
 * Call this AFTER a successful agent turn has been persisted. It:
 *  1. Counts the session's assistant ('output') message rounds. If fewer than
 *     {@link MIN_ROUNDS}, returns immediately without touching the LLM.
 *  2. Otherwise kicks off {@link distillFromSession} WITHOUT awaiting it, so the
 *     caller's turn/run resolves before the (potentially slow) distill does.
 *
 * Contract — this function:
 *  • NEVER throws (the round-count query is wrapped in try/catch).
 *  • NEVER awaits the distill — it is genuinely fire-and-forget.
 *  • NEVER rejects the caller — a distill that throws/rejects is swallowed here.
 *
 * Inert under test: {@link distillFromSession} itself no-ops under VITEST /
 * Postgres, so wiring this into real run/turn paths stays a no-op in CI unless a
 * test injects a fake `distill`.
 */
export function queueSkillExtraction(sessionId: string, distill: DistillFn = distillFromSession): void {
  // #746 — Defer curator during the cold-start window so background skill work
  // does not contend with the first interactive session. Non-fatal: logs and exits.
  if (isCuratorThrottled()) {
    const elapsed = _engineReadyAt !== null ? Date.now() - _engineReadyAt : 0;
    logger.info(
      `[skill-extract] queue: throttled during engine cold-start window (${elapsed}ms elapsed of ${CURATOR_COLD_WINDOW_MS}ms) for ${sessionId} — skipping`,
    );
    return;
  }

  let rounds = 0;
  try {
    const msgRepo = new AgentSessionMessagesRepository();
    const all = msgRepo.listBySession(sessionId, 200);
    rounds = all.filter((m) => m.role === 'output').length;
  } catch (err) {
    // Never throw — the caller is fire-and-forget.
    logger.warn(`[skill-extract] queue: round-count failed (non-fatal): ${String(err)}`);
    return;
  }

  if (rounds < MIN_ROUNDS) {
    logger.info(`[skill-extract] queue: below threshold (rounds=${rounds} < ${MIN_ROUNDS}) for ${sessionId} — skipping`);
    return;
  }

  logger.info(`[skill-extract] queued for ${sessionId}`);
  // Fire-and-forget — do NOT await. Swallow any rejection so the caller's
  // promise can never be affected by the distill outcome.
  try {
    Promise.resolve(distill(sessionId))
      .then((skill) => {
        if (skill) logger.info(`[skill-extract] drafted ${skill.title}`);
      })
      .catch((e) => logger.error(`[skill-extract] failed: ${String(e)}`));
  } catch (e) {
    // Guards a distill that throws SYNCHRONOUSLY (before returning a promise).
    logger.error(`[skill-extract] failed: ${String(e)}`);
  }
}
