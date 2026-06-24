/**
 * AgentSkill — a single entry in the shared, self-improving skill library.
 *
 * Skills are SHARED instance-wide (Odysseus-style). There is intentionally NO
 * owner scoping: any agent can read and reuse any skill.
 *
 * `steps` and `tags` are JSON arrays persisted as *_json TEXT columns. The
 * model exposes BOTH the parsed arrays (`steps` / `tags`, convenient for
 * consumers) AND the raw JSON strings (`stepsJson` / `tagsJson`, the literal
 * column values) so callers can use whichever they need.
 */
export interface AgentSkill {
  id: string;
  title: string;
  whenToUse: string | null;
  description: string | null;
  /** Parsed convenience view of steps_json. Optional — derived from stepsJson. */
  steps?: string[] | null;
  /** Parsed convenience view of tags_json. Optional — derived from tagsJson. */
  tags?: string[] | null;
  /** Raw steps_json column value (JSON-encoded string[] or null). */
  stepsJson: string | null;
  /** Raw tags_json column value (JSON-encoded string[] or null). */
  tagsJson: string | null;
  /**
   * Full markdown procedure body for prose/seed skills (everything after the
   * frontmatter block). Null for extracted skills that use `steps` instead.
   */
  body: string | null;
  confidence: number;
  status: string;
  source: string | null;
  uses: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSkillInput {
  id?: string;
  title: string;
  whenToUse?: string | null;
  description?: string | null;
  steps?: string[] | null;
  tags?: string[] | null;
  body?: string | null;
  confidence?: number;
  status?: string;
  source?: string | null;
  uses?: number;
}
