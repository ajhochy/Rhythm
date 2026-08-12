/**
 * agent_skill_wiring.ts — issue #958.
 *
 * An agent's system prompt (its "role" body) tells the model which workflow
 * SKILL to load, in prose, e.g. "load and follow the `AI-Trend-Researcher`
 * skill". But the fork only lets the model load a skill that is BOTH (a) in the
 * agent's `allowed_skills_json` allowlist (the #775 per-session scope the fork
 * actually enforces) AND (b) an enabled/discovered skill whose SKILL.md
 * frontmatter `name` EXACTLY matches. When those three names disagree — body
 * reference vs. allowlist entry vs. live skill name — the agent silently runs
 * WITHOUT the workflow it was told to use (the AI-Trend-Researcher failure in
 * #958: body says `AI-Trend-Researcher`, allowlist has none of it, and the real
 * skill is titled "AI Trend Research with Obsidian Brief and Dashboard").
 *
 * This module is the CANONICAL-NAME wiring check, kept as a PURE data helper
 * (no I/O, no DB, no HTTP) so it can back both:
 *   - the lint/validation surface (GET /agent-configs/skill-wiring), and
 *   - the write-point guard on programmatic agent creation
 *     (new_agent_generator.ts), which refuses to emit/apply an agent whose body
 *     references a skill it is not scoped for.
 *
 * It does NOT remediate data — re-enabling/renaming the real workflow skills is
 * the one-time cleanup tracked in #961. This only PREVENTS recurrence and
 * SURFACES the current mismatches.
 */

/** One agent's wiring inputs, as stored on `agent_configs`. */
export interface AgentWiringInput {
  id: string;
  label?: string | null;
  systemPrompt: string | null;
  /**
   * Parsed `allowed_skills_json`. `null` means unrestricted (fail-open — the
   * agent may load any skill), which is NOT a mismatch. `[]` means "no skills
   * allowed", so any body reference is a mismatch.
   */
  allowedSkills: string[] | null;
}

export type SkillWiringReason = 'not-in-allowlist' | 'not-enabled';

/** A single agent→skill wiring mismatch, one per (agent, referenced skill). */
export interface AgentSkillWiringMismatch {
  agentId: string;
  agentLabel: string;
  /** The skill name exactly as the agent body references it. */
  skillName: string;
  /** Why the wiring is broken (may hold both reasons at once). */
  reasons: SkillWiringReason[];
}

export interface ResearchCapabilityDiagnosticsInput {
  requestedSkills: string[];
  availableSkills: string[];
  requestedMcps: string[];
  mcpStatuses: Record<string, string | undefined>;
  vaultWritable: boolean;
}

export interface ResearchChannelDiagnostic {
  available: boolean;
  action: 'available' | 'fallback' | 'skip';
  via: string | null;
  reason?: string;
}

export interface ResearchCapabilityDiagnostics {
  skills: { requested: string[]; available: string[]; unavailable: string[] };
  mcps: { requested: string[]; available: string[]; unavailable: string[] };
  channels: Record<'exa' | 'x' | 'reddit' | 'youtube' | 'gmail', ResearchChannelDiagnostic>;
  fallbacks: string[];
  vaultWritable: boolean;
}

const RESEARCH_PROFILE_IDS = new Set([
  'research',
  'AI-Trend-Researcher',
  'Theological-Researcher',
]);
const OPTIONAL_RESEARCH_MCPS = new Set([
  'exa',
  'playwright',
  'scrapling',
  'pdf-tools',
  'minutes',
  'youtube-transcript',
  'gmail-work',
  'gmail-personal',
]);

export function partitionResearchMcpPreflight(
  profileId: string | null | undefined,
  unavailableServers: string[],
  researchProjectsEnabled = true,
): { blocking: string[]; degraded: string[] } {
  if (!researchProjectsEnabled || !profileId || !RESEARCH_PROFILE_IDS.has(profileId)) {
    return { blocking: unavailableServers, degraded: [] };
  }
  return {
    blocking: unavailableServers.filter((name) => !OPTIONAL_RESEARCH_MCPS.has(name)),
    degraded: unavailableServers.filter((name) => OPTIONAL_RESEARCH_MCPS.has(name)),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Build the JSON-safe research preflight snapshot persisted with project runs.
 * Gmail is deliberately capability-based: merely requesting it never grants
 * inbox access, and a disconnected Gmail MCP always resolves to `skip`.
 */
export function buildResearchCapabilityDiagnostics(
  input: ResearchCapabilityDiagnosticsInput,
): ResearchCapabilityDiagnostics {
  const requestedSkills = unique(input.requestedSkills);
  const availableSkillSet = new Set(input.availableSkills);
  const availableSkills = requestedSkills.filter((name) => availableSkillSet.has(name));
  const requestedMcps = unique(input.requestedMcps);
  const connected = (name: string) => input.mcpStatuses[name] === 'connected';
  const availableMcps = requestedMcps.filter(connected);
  const hasAgentReach = availableSkillSet.has('agent-reach');
  const hasWebFallback = hasAgentReach || connected('playwright') || connected('scrapling');
  const gmailServer = ['gmail-work', 'gmail-personal'].find(connected) ?? null;

  const channels: ResearchCapabilityDiagnostics['channels'] = {
    exa: connected('exa')
      ? { available: true, action: 'available', via: 'exa' }
      : hasWebFallback
        ? { available: false, action: 'fallback', via: hasAgentReach ? 'agent-reach' : 'web', reason: 'exa unavailable' }
        : { available: false, action: 'skip', via: null, reason: 'exa unavailable and no safe fallback' },
    x: hasAgentReach
      ? { available: true, action: 'available', via: 'agent-reach' }
      : { available: false, action: 'skip', via: null, reason: 'agent-reach unavailable' },
    reddit: hasAgentReach
      ? { available: true, action: 'available', via: 'agent-reach' }
      : { available: false, action: 'skip', via: null, reason: 'agent-reach unavailable' },
    youtube: connected('youtube-transcript')
      ? { available: true, action: 'available', via: 'youtube-transcript' }
      : hasAgentReach
        ? { available: false, action: 'fallback', via: 'agent-reach', reason: 'youtube-transcript unavailable' }
        : { available: false, action: 'skip', via: null, reason: 'YouTube capability unavailable' },
    gmail: gmailServer
      ? { available: true, action: 'available', via: gmailServer }
      : { available: false, action: 'skip', via: null, reason: 'Gmail capability unavailable' },
  };

  return {
    skills: {
      requested: requestedSkills,
      available: availableSkills,
      unavailable: requestedSkills.filter((name) => !availableSkillSet.has(name)),
    },
    mcps: {
      requested: requestedMcps,
      available: availableMcps,
      unavailable: requestedMcps.filter((name) => !connected(name)),
    },
    channels,
    fallbacks: Object.entries(channels)
      .filter(([, channel]) => channel.action === 'fallback')
      .map(([name, channel]) => `${name}:${channel.via}`),
    vaultWritable: input.vaultWritable,
  };
}

/**
 * Extract the skill names an agent's system prompt tells the model to load.
 *
 * Matches the established convention in the repo's agent bodies: one or more
 * back-tick-quoted names immediately followed by the word "skill"/"skills",
 * with an optional `/`-separated chain (e.g. "`obsidian-cli` / `obsidian-markdown`
 * skills"). Names are returned de-duplicated, in first-seen order.
 *
 * ponytail: heuristic extractor — a `/`-chain or a single "`name` skill(s)"
 * phrase. It deliberately does NOT parse comma+"and" lists (e.g.
 * "`a`, `b`, and `c` skills"), which in practice enumerate tool/MCP names, not
 * workflow skills — under-extraction is the safe direction for a lint (fewer
 * false alarms). Broaden the separator only if a real workflow skill is missed.
 */
export function extractReferencedSkillNames(systemPrompt: string | null): string[] {
  if (!systemPrompt) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  // A "`x`( / `y`)* skill(s)" phrase.
  const phraseRe = /(`[^`]+`(?:\s*\/\s*`[^`]+`)*)\s+skills?\b/gi;
  const tokenRe = /`([^`]+)`/g;
  let phrase: RegExpExecArray | null;
  while ((phrase = phraseRe.exec(systemPrompt)) !== null) {
    let token: RegExpExecArray | null;
    tokenRe.lastIndex = 0;
    while ((token = tokenRe.exec(phrase[1])) !== null) {
      const name = token[1].trim();
      if (name === '' || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Flag every agent→skill reference that will not resolve: the body names a
 * skill that is either absent from the agent's allowlist or not an
 * enabled/discovered skill of that exact name.
 *
 *   - allowedSkills === null → unrestricted; the allowlist check is skipped
 *     (fail-open, never a mismatch on scope grounds).
 *   - liveSkillNames empty (engine down / not ready) → the enabled check is
 *     skipped (cannot judge — mirrors the fail-open rule used across the
 *     org-audit / name-alignment paths). The allowlist check still runs.
 *   - A referenced name passing BOTH checks produces no row.
 */
export function detectAgentSkillWiringMismatches(
  agents: AgentWiringInput[],
  liveSkillNames: Set<string>,
): AgentSkillWiringMismatch[] {
  const canJudgeEnabled = liveSkillNames.size > 0;
  const mismatches: AgentSkillWiringMismatch[] = [];
  for (const agent of agents) {
    const referenced = extractReferencedSkillNames(agent.systemPrompt);
    if (referenced.length === 0) continue;
    const allowlist = agent.allowedSkills; // null = unrestricted
    for (const skillName of referenced) {
      const reasons: SkillWiringReason[] = [];
      if (allowlist !== null && !allowlist.includes(skillName)) {
        reasons.push('not-in-allowlist');
      }
      if (canJudgeEnabled && !liveSkillNames.has(skillName)) {
        reasons.push('not-enabled');
      }
      if (reasons.length > 0) {
        mismatches.push({
          agentId: agent.id,
          agentLabel: agent.label ?? agent.id,
          skillName,
          reasons,
        });
      }
    }
  }
  return mismatches;
}
