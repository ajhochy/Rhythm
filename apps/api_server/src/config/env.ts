import os from 'os';
import path from 'path';

export type DbClient = 'sqlite' | 'postgres';

/**
 * Deployment role (#755). Gates the agent-EXECUTION surfaces (agent routes,
 * AgentScheduler, opencode/managed-Chrome init, WS gateway, agent
 * session/config table DDL) so a hosted production API can run without the
 * agent runtime it never uses.
 *
 * - `all`   (DEFAULT) — every agent surface registered + initialized.
 *           No-regression default: the embedded local server and the current
 *           single prod image both keep working with no env change.
 * - `local` — local agent server (localhost:4001, SQLite). Behaves like `all`.
 * - `cloud` — hosted production API. Agent-execution surfaces are NOT
 *           registered/initialized; prod-owned surfaces (trigger queue,
 *           scheduled-task records) stay.
 *
 * Orthogonal to AGENT_LOCAL (the auth-bypass flag): RHYTHM_ROLE decides whether
 * the surfaces exist; AGENT_LOCAL decides whether auth is bypassed on them.
 */
export type DeploymentRole = 'all' | 'cloud' | 'local';

function parseRole(value: string): DeploymentRole {
  if (value === 'all' || value === 'cloud' || value === 'local') {
    return value;
  }

  throw new Error(
    `Unsupported RHYTHM_ROLE "${value}". Expected "all", "cloud", or "local".`,
  );
}

const roleRaw = (process.env.RHYTHM_ROLE ?? '').trim().toLowerCase();
// Unset OR empty both mean the default 'all' (an empty env var is "not set").
const deploymentRole = parseRole(roleRaw === '' ? 'all' : roleRaw);

/**
 * Expand a leading `~` (or `~/`) to the current user's home directory.
 * Only a leading tilde is expanded — `~user` syntax is intentionally not
 * supported. Returns the path unchanged when there is no leading tilde.
 */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Issue #770 WI6: resolve the Memory-Vault path FRESH from process.env at call
 * time (with `~` expansion). `env.memoryVaultPath` snapshots this at module
 * load for documentation/most callers, but the mirror-sync resolves lazily so
 * the path can be overridden after import (e.g. by tests, or a late-loaded
 * .env). Default: ~/Documents/Memory-Vault.
 */
export function resolveMemoryVaultPath(): string {
  return expandHome(process.env.MEMORY_VAULT_PATH ?? '~/Documents/Memory-Vault');
}

/**
 * Issue #803: resolve the MEMORY DIR — the single subtree of the Memory-Vault
 * that the vault-first `remember` write path owns. All notes the local
 * `POST /agent-memory` writes (and `DELETE /agent-memory/:id` removes) live
 * under here, laid out folders-by-type as `<memoryDir>/<kind>/<slug>.md`.
 *
 * Resolved FRESH from process.env at call time (so tests / a late .env can
 * override the vault path). The write path treats this dir as the
 * path-traversal boundary — nothing is ever written or deleted outside it.
 *
 * Subfolder is `MEMORY_VAULT_SUBDIR` (default `memory`, back-compat). Set it to
 * an EMPTY string to write kind-folders directly under MEMORY_VAULT_PATH — e.g.
 * MEMORY_VAULT_PATH=`~/Documents/Obsidian Vault/AGENT-MEMORY` + MEMORY_VAULT_SUBDIR=``
 * → notes at `AGENT-MEMORY/<kind>/<slug>.md`. Keep MEMORY_VAULT_PATH scoped to a
 * dedicated agent-memory dir: the sync/index scanner reads it recursively, so it
 * must NOT be pointed at a whole multi-purpose Obsidian vault root.
 */
export function resolveMemoryDirPath(): string {
  const sub = process.env.MEMORY_VAULT_SUBDIR ?? 'memory';
  return sub ? path.join(resolveMemoryVaultPath(), sub) : resolveMemoryVaultPath();
}

/**
 * Google Cloud project ID used to enable the native Google Gemini provider in
 * the embedded opencode engine. The `opencode-gemini-auth` plugin only
 * registers the `google` provider for Google **Workspace** accounts when
 * `provider.google.options.projectId` is present in opencode.json. Rhythm is a
 * single-org internal app (all users are in the `visaliacrc.com` Workspace), so
 * this is a shared constant. Overridable via env so it never needs a code
 * change to update.
 */
export const GEMINI_CODE_ASSIST_PROJECT_ID =
  process.env.GEMINI_PROJECT_ID ||
  process.env.OPENCODE_GEMINI_PROJECT_ID ||
  'rhythm-491406';

const dbClientValue = (process.env.DB_CLIENT ?? 'sqlite').trim().toLowerCase();

function parseDbClient(value: string): DbClient {
  if (value === 'sqlite' || value === 'postgres') {
    return value;
  }

  throw new Error(
    `Unsupported DB_CLIENT "${value}". Expected "sqlite" or "postgres".`,
  );
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  /** #755 — deployment role; see DeploymentRole above. Default 'all'. */
  role: deploymentRole,
  /**
   * #755 — single switch every agent-execution gate reads. True for the 'all'
   * and 'local' roles, false for 'cloud'. Keeping the policy in one derived
   * boolean means route registration, startup init, and Postgres DDL all gate
   * on the same condition.
   */
  agentExecutionEnabled: deploymentRole !== 'cloud',
  dbClient: parseDbClient(dbClientValue),
  dbPath: process.env.DB_PATH ?? path.join(process.cwd(), 'rhythm.db'),
  dbHost: process.env.DB_HOST ?? 'localhost',
  dbPort: Number(process.env.DB_PORT ?? 5432),
  dbName: process.env.DB_NAME ?? 'rhythm',
  dbUser: process.env.DB_USER ?? '',
  dbPassword: process.env.DB_PASSWORD ?? '',
  dbSsl: (process.env.DB_SSL ?? 'false').trim().toLowerCase() === 'true',
  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0),
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleAuthClientId:
    process.env.GOOGLE_AUTH_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? '',
  googleAuthClientSecret:
    process.env.GOOGLE_AUTH_CLIENT_SECRET ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  googleRedirectUri:
    process.env.GOOGLE_REDIRECT_URI ??
    'http://localhost:4000/auth/google/callback',
  pcoApplicationId: process.env.PCO_APPLICATION_ID ?? '',
  pcoSecret: process.env.PCO_SECRET ?? '',
  pcoRedirectUri:
    process.env.PCO_REDIRECT_URI ??
    'http://localhost:4000/auth/planning-center/callback',
  pcoScopes: process.env.PCO_SCOPES ?? 'openid services',
  pcoNeededTaskWindowDays: Number(process.env.PCO_NEEDED_TASK_WINDOW_DAYS ?? 14),
  pcoDeclineTaskWindowDays: Number(
    process.env.PCO_DECLINE_TASK_WINDOW_DAYS ?? 14,
  ),
  pcoSpecialProjectWindowDays: Number(
    process.env.PCO_SPECIAL_PROJECT_WINDOW_DAYS ?? 30,
  ),
  pcoIgnoredServiceTypeKeywords: (process.env.PCO_IGNORED_SERVICE_TYPE_KEYWORDS ??
          'training,rehearsal')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  pcoIncludedPositionKeywords: (process.env.PCO_INCLUDED_POSITION_KEYWORDS ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  pcoExcludedPositionKeywords: (process.env.PCO_EXCLUDED_POSITION_KEYWORDS ??
          'nursery,children,helper,volunteer')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  claudeUserId: (() => {
    const raw = process.env.CLAUDE_USER_ID;
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      console.warn(`[env] CLAUDE_USER_ID="${raw}" is not a valid integer — treating as null`);
      return null;
    }
    return parsed;
  })(),
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  emailFromAddress: process.env.EMAIL_FROM_ADDRESS ?? 'Rhythm <onboarding@resend.dev>',
  agentLocal: process.env.AGENT_LOCAL === 'true',
  /**
   * P3-2: instance-wide toggle for injecting retrieved skills into the agent
   * prompt preface. Default ON. Only the explicit strings 'false' or '0'
   * disable it (any other value, including unset, leaves it enabled). This is
   * instance-wide, NOT per-user — skills are a shared library (OQ-6).
   */
  agentSkillsEnabled: (() => {
    const raw = (process.env.AGENT_SKILLS_ENABLED ?? '').trim().toLowerCase();
    return !(raw === 'false' || raw === '0');
  })(),
  /**
   * P5-2: instance-wide toggle for the self-refinement loop (improving EXISTING
   * skills in place). Default ON. Only the explicit strings 'false' or '0'
   * disable it. When OFF the loop still drafts NEW skills but never revises an
   * existing one. The live gate in skill_refiner.ts uses
   * `isSkillRefinementEnabled()` (re-reads process.env per call) for
   * test/per-call toggling; this is the documented config surface.
   */
  agentSkillRefinementEnabled: (() => {
    const raw = (process.env.AGENT_SKILL_REFINEMENT_ENABLED ?? '').trim().toLowerCase();
    return !(raw === 'false' || raw === '0');
  })(),
  /**
   * FOLLOW-UP (memory injection): instance-wide toggle for injecting relevant
   * stored memories (facts & preferences) into the agent prompt preface as a
   * transient "Known context" block. Default ON. Only the explicit strings
   * 'false' or '0' disable it (any other value, including unset, leaves it
   * enabled). Instance-wide, NOT per-user — but RETRIEVAL is owner-scoped at the
   * call site (memory is per-user; see memory_retrieval.ts). The live gate in
   * callers uses `isMemoryInjectionEnabled()` (re-reads process.env per call) so
   * the toggle is testable without a process restart; this remains the
   * documented config surface (mirrors agentSkillsEnabled).
   */
  agentMemoryInjectionEnabled: (() => {
    const raw = (process.env.AGENT_MEMORY_INJECTION_ENABLED ?? '').trim().toLowerCase();
    return !(raw === 'false' || raw === '0');
  })(),
  /**
   * P4-1: stronger "teacher" model used when a weaker-model run fails and the
   * teacher-escalation path re-runs it. Format 'provider/modelId'
   * (e.g. 'anthropic/claude-opus-4-8'). Override with AGENT_TEACHER_MODEL.
   * Parsed lazily by AgentRunner (split on the FIRST '/').
   */
  agentTeacherModel: process.env.AGENT_TEACHER_MODEL ?? 'anthropic/claude-opus-4-8',
  /**
   * P4-1: instance-wide toggle for the teacher-escalation path. Default ON.
   * Only the explicit strings 'false' or '0' disable it (any other value,
   * including unset, leaves it enabled). Instance-wide, NOT per-user.
   *
   * COST NOTE: when ON, every run that resolves with status==='error' triggers
   * a second (stronger-model) re-run — this roughly DOUBLES the cost of FAILED
   * runs. Successful runs are unaffected (no escalation). Escalation happens at
   * most once per run (recursion-guarded).
   */
  agentTeacherEscalationEnabled: (() => {
    const raw = (process.env.AGENT_TEACHER_ESCALATION_ENABLED ?? '').trim().toLowerCase();
    return !(raw === 'false' || raw === '0');
  })(),
  /** URL of the production Rhythm API to mirror tasks from (agent-local mode only).
   *  Set via PROD_API_URL env var.  When absent, production task mirroring is skipped. */
  prodApiUrl: process.env.PROD_API_URL ?? null,
  /** Bearer token to authenticate against the production API for task mirroring. */
  prodAuthToken: process.env.PROD_AUTH_TOKEN ?? null,
  /**
   * Issue #770 WI6: filesystem path to the dedicated Obsidian "Memory-Vault"
   * that is the canonical store for agent memory. The mirror-sync job reads all
   * `.md` notes here (direct file read — no Obsidian instance required) and
   * upserts them into the agent_memory table so the Rhythm Brain panel can
   * display them. A leading `~` is expanded to the user's home dir. If the path
   * does not exist the sync is a no-op (never an error). Overridable via
   * MEMORY_VAULT_PATH (the test suite points this at a temp fixture dir).
   */
  memoryVaultPath: expandHome(
    process.env.MEMORY_VAULT_PATH ?? '~/Documents/Memory-Vault',
  ),
  /**
   * Issue #770 WI6: cron expression for the Memory-Vault mirror-sync job.
   * Defaults to every 10 minutes. Overridable via MEMORY_VAULT_SYNC_CRON.
   */
  memoryVaultSyncCron: process.env.MEMORY_VAULT_SYNC_CRON ?? '*/10 * * * *',
};
