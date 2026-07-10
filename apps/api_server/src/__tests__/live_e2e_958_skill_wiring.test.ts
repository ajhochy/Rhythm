import { assertLiveE2EIsolation } from './_live_e2e_guard';
/**
 * Live E2E for #958 — agent→workflow-skill wiring lint against the real backend.
 *
 * Gated behind RHYTHM_LIVE_E2E=1. Does NOT run in the normal `vitest run`
 * suite (it hits the running local agent server on :4001 and its live engine).
 *
 * Run it:
 *   RHYTHM_LIVE_E2E=1 npx vitest run __tests__/live_e2e_958_skill_wiring.test.ts
 *
 * Prerequisites:
 *   - api_server running on localhost:4001 (AGENT_LOCAL=true → no bearer token).
 *   - the opencode engine spawned and ready (GET /opencode/health → ready), so
 *     GET /opencode/skills returns the live enabled skill names.
 *
 * What it proves (the observable outcome, not the code):
 *   1. The lint surface GET /agent-configs/skill-wiring works end-to-end
 *      against the real engine + DB and returns a well-formed report over
 *      EVERY agent — the "audit across all agents" the issue asks for.
 *   2. Its verdict is CONSISTENT with the two source-of-truth surfaces it
 *      lints: for each reported mismatch, the referenced skill is genuinely
 *      absent from that agent's `allowed_skills_json` (GET /agent-configs) or
 *      absent from the live skill set (GET /opencode/skills). I.e. the lint
 *      reports real wiring breaks, not phantom ones.
 *
 * NOTE: this asserts the LINT behavior, not that the corpus is clean. Until
 * the #961 data remediation runs, real agents (e.g. AI-Trend-Researcher) will
 * legitimately appear as mismatches — that is the lint doing its job, and this
 * test logs the full affected list for that remediation.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
// #1001: refuse to run against a non-isolated backend (prevents the test-agent leak).
if (LIVE) assertLiveE2EIsolation();
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://localhost:4001';
const describeLive = LIVE ? describe : describe.skip;

interface Mismatch {
  agentId: string;
  agentLabel: string;
  skillName: string;
  reasons: string[];
}
interface LintReport {
  engineAvailable: boolean;
  liveSkillCount: number;
  checkedAgents: number;
  mismatchCount: number;
  mismatches: Mismatch[];
}
interface AgentConfig {
  id: string;
  allowedSkillsJson: string | null;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

describeLive('#958 live — agent→skill wiring lint', () => {
  let report: LintReport;
  let agentsById: Map<string, string[] | null>;
  let liveSkillNames: Set<string>;

  beforeAll(async () => {
    report = await getJson<LintReport>('/agent-configs/skill-wiring');

    const configs = await getJson<AgentConfig[]>('/agent-configs');
    agentsById = new Map(
      configs.map((c) => {
        let allow: string[] | null = null;
        if (c.allowedSkillsJson) {
          try {
            const parsed = JSON.parse(c.allowedSkillsJson);
            allow = Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : null;
          } catch {
            allow = null;
          }
        }
        return [c.id, allow] as const;
      }),
    );

    const skills = await getJson<Array<{ name: string }>>('/opencode/skills');
    liveSkillNames = new Set(skills.map((s) => s.name));

    // eslint-disable-next-line no-console
    console.log(
      `[#958 lint] checkedAgents=${report.checkedAgents} liveSkills=${report.liveSkillCount} mismatches=${report.mismatchCount}`,
    );
    for (const m of report.mismatches) {
      // eslint-disable-next-line no-console
      console.log(`  - ${m.agentId}: "${m.skillName}" (${m.reasons.join(', ')})`);
    }
  });

  it('returns a well-formed report over every agent, with the engine reachable', () => {
    expect(report.engineAvailable).toBe(true);
    expect(report.liveSkillCount).toBeGreaterThan(0);
    expect(report.checkedAgents).toBeGreaterThan(0);
    expect(Array.isArray(report.mismatches)).toBe(true);
    expect(report.mismatchCount).toBe(report.mismatches.length);
  });

  it('every reported mismatch is a REAL wiring break (consistent with allowlist + live skills)', () => {
    for (const m of report.mismatches) {
      expect(m.reasons.length).toBeGreaterThan(0);
      const allowlist = agentsById.get(m.agentId);
      if (m.reasons.includes('not-in-allowlist')) {
        // The agent has a non-null allowlist that genuinely lacks this skill.
        expect(allowlist).not.toBeNull();
        expect(allowlist).not.toContain(m.skillName);
      }
      if (m.reasons.includes('not-enabled')) {
        expect(liveSkillNames.has(m.skillName)).toBe(false);
      }
    }
  });

  it('a correctly-wired reference is never falsely flagged (spot-check: coding-agent)', () => {
    // The `coding-agent` profile references the `coding-agent` skill in its
    // body; if that skill is live and in-allowlist, it must NOT be a mismatch.
    const codingAgentAllow = agentsById.get('coding-agent');
    if (codingAgentAllow && codingAgentAllow.includes('coding-agent') && liveSkillNames.has('coding-agent')) {
      const flagged = report.mismatches.some(
        (m) => m.agentId === 'coding-agent' && m.skillName === 'coding-agent',
      );
      expect(flagged).toBe(false);
    }
  });
});
