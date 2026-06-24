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
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
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

/** How many recent messages to include (Odysseus CONTEXT_WINDOW). */
const CONTEXT_WINDOW = 12;

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

/** Injectable LLM call: (systemPrompt, userContent) => raw model text. */
export type LlmCall = (systemPrompt: string, userContent: string) => Promise<string>;

/**
 * Default (real) LLM call — thin + guarded. Creates a throwaway opencode
 * session and fires one synchronous prompt using resolveRunModel(). Lazy
 * imports keep opencode/AgentRunner out of the module's hot path (and out of
 * test bundles, since this is never reached under isTestEnv).
 */
const defaultLlmCall: LlmCall = async (systemPrompt, userContent) => {
  const { opencodeClient } = await import('./opencode_engine');
  const { resolveRunModel } = await import('./agent_runner');
  // No agentConfigId — cheap background distill rides MRU/default model tier.
  const model = resolveRunModel();
  const session = await opencodeClient.createSession('skill-extract');
  if (!session?.id) return '';
  const combined = `${systemPrompt}\n\n${userContent}`;
  const resp = await opencodeClient.prompt(session.id, combined, model, undefined, {
    permissionMode: 'bypassPermissions',
  });
  const parts = resp?.parts ?? [];
  return parts
    .filter((p): p is import('@opencode-ai/sdk').TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
    .trim();
};

export interface DistillOptions {
  /** Injectable LLM call for tests; defaults to the real opencode-backed impl. */
  llmCall?: LlmCall;
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
        if (content.length > 500) content = content.slice(0, 500) + '...';
        return `[${m.role}] ${content}`;
      })
      .join('\n');

    const systemPrompt = buildSystemPrompt(rounds);
    const userContent = `Conversation:\n${conversation}`;

    let response: string;
    try {
      response = await llmCall(systemPrompt, userContent);
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
    if (repo.findByTitle(title)) {
      logger.info(`[skill-extract] '${title}' already exists — dup skipped`);
      return null;
    }

    const problem = typeof data.problem === 'string' ? data.problem.trim() : '';
    const solution = typeof data.solution === 'string' ? data.solution.trim() : '';
    const description = [problem, solution].filter((s) => s.length > 0).join('\n\n') || solution || null;

    const steps = Array.isArray(data.steps)
      ? (data.steps.filter((s) => typeof s === 'string') as string[])
      : null;
    const tags = Array.isArray(data.tags)
      ? (data.tags.filter((t) => typeof t === 'string') as string[])
      : null;

    const created = repo.create({
      title,
      description,
      steps,
      tags,
      confidence,
      status: 'draft',
      source: 'auto-extract',
    });
    logger.info(`[skill-extract] drafted skill '${title}' (id=${created.id})`);
    return created;
  } catch (err) {
    // NEVER throw — fire-and-forget caller (P2-2) depends on this.
    logger.warn(`[skill-extract] FAILED (non-fatal): ${String(err)}`);
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
