import os from 'os';
import path from 'path';
import { isIP } from 'node:net';

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
export type DeploymentRole = 'all' | 'cloud' | 'local' | 'relay';

function parseRole(value: string): DeploymentRole {
  if (
    value === 'all' ||
    value === 'cloud' ||
    value === 'local' ||
    value === 'relay'
  ) {
    return value;
  }

  throw new Error(
    `Unsupported RHYTHM_ROLE "${value}". Expected "all", "cloud", "local", or "relay".`,
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

/** App-managed root for immutable live-artifact bundle and state bytes. */
export function resolveLiveArtifactStorageDir(): string {
  return expandHome(process.env.LIVE_ARTIFACT_STORAGE_DIR ?? path.join(process.cwd(), 'live-artifacts'));
}

/** D1.4: managed executable tools never use cwd, PATH, or a user package prefix. */
function rhythmApplicationDataDir(): string {
  return path.dirname(expandHome(process.env.DB_PATH ?? path.join(os.homedir(), 'Library', 'Application Support', 'Rhythm', 'rhythm.db')));
}

export function resolveManagedToolRoot(): string {
  return expandHome(process.env.RHYTHM_MANAGED_TOOL_ROOT ?? path.join(rhythmApplicationDataDir(), 'managed-tools'));
}

export function resolveManagedToolArtifactRoot(): string {
  return expandHome(process.env.RHYTHM_TOOL_ARTIFACT_ROOT ?? path.join(rhythmApplicationDataDir(), 'tool-artifacts'));
}

/** Filesystem root for checksum-addressed generated media bytes (#1309). */
export function resolveMediaArtifactStorageRoot(): string {
  const appDataDir = path.dirname(
    expandHome(process.env.DB_PATH ?? path.join(process.cwd(), 'rhythm.db')),
  );
  return expandHome(
    process.env.ARTIFACT_STORAGE_ROOT ?? path.join(appDataDir, 'media-artifacts'),
  );
}

/** Retention period for unpinned generated media. Invalid values use 30 days. */
export function resolveMediaArtifactRetentionDays(): number {
  const parsed = Number(process.env.ARTIFACT_RETENTION_DAYS ?? 30);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 30;
}

/**
 * #1093 prompt-retrieval augmentation, promoted to the DEFAULT lane (step 2 of
 * the semantic-memory rollout). `hybrid` is now what unset AND unrecognized
 * values both resolve to — the semantic (Engraph) lane runs by default and
 * degrades to pure FTS whenever no Engraph backend is configured/healthy (see
 * `engraphManager.getRetrievalClient()` / `EngraphHttpClient`, both fail-closed
 * to `[]`), so this is safe with no Engraph installed. Only an explicit `fts`
 * (trimmed, case-insensitive) opts back out to FTS-only retrieval.
 */
export function getAgentMemoryRetrievalMode(): 'fts' | 'hybrid' {
  return process.env.AGENT_MEMORY_RETRIEVAL_MODE?.trim().toLowerCase() === 'fts'
    ? 'fts'
    : 'hybrid';
}

/**
 * Root used by the operator-managed Engraph HTTP service. It may be the memory
 * directory itself or its parent vault; results are still confined to
 * resolveMemoryDirPath() before joining index rows.
 */
export function resolveEngraphMemoryVaultRoot(): string {
  return expandHome(process.env.ENGRAPH_MEMORY_VAULT_ROOT ?? resolveMemoryDirPath());
}

/**
 * Step 3 of the semantic-memory rollout (steps 1-2 made hybrid retrieval the
 * default): a configurable prompt-path latency budget for the Engraph
 * semantic search, resolved FRESH from process.env at call time (mirrors
 * `getAgentMemoryRetrievalMode`'s "read live" convention). This bounds how
 * long a slow/hung Engraph service can delay a user's FIRST prompt response —
 * the semantic search runs in parallel with FTS on the prompt path
 * (`getRelevantMemoriesSemantic`), so this budget is used as the search
 * timeout at both prompt-path `EngraphHttpClient` construction sites
 * (`EngraphManager.getRetrievalClient()` and the default `engraph` param of
 * `getRelevantMemoriesSemantic`). Override via AGENT_MEMORY_SEMANTIC_BUDGET_MS
 * (must be a positive integer; anything else, including unset/empty/zero/
 * negative/non-numeric, falls back to the 500ms default). This is a separate,
 * steady-state budget from the manager's own health-check/startup/index
 * lifecycle timeouts (HEALTH_CHECK_BUDGET_MS etc. in engraph_manager.ts),
 * which are unaffected.
 */
export function getSemanticSearchBudgetMs(): number {
  const raw = process.env.AGENT_MEMORY_SEMANTIC_BUDGET_MS;
  if (raw === undefined) return 500;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return 500;
  return parsed;
}

/** Optional one-hop memory-link expansion. Explicit opt-in; default OFF. */
export function isMemoryLinkExpansionEnabled(): boolean {
  const raw = (process.env.AGENT_MEMORY_LINK_EXPANSION_ENABLED ?? '')
    .trim()
    .toLowerCase();
  return raw === 'true' || raw === '1';
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
const agentLocal = process.env.AGENT_LOCAL === 'true';

function validBindHostname(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false;
  if (value === 'localhost') return true;
  return value.split('.').every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
  );
}

/**
 * #1175 — resolve the primary API listener host.
 *
 * AGENT_LOCAL disables authentication on internal execution routes, so it is
 * structurally coupled to an IPv4-loopback-only listener. `localhost` is not
 * accepted in that mode because resolver order can select IPv6 or a
 * machine-managed address. Non-local deployments preserve the historical
 * wildcard listener unless API_BIND_HOST is explicitly configured.
 */
export function resolveApiBindHost(options: {
  agentLocal?: boolean;
  configuredHost?: string;
} = {}): string {
  const local = options.agentLocal ?? process.env.AGENT_LOCAL === 'true';
  const configured = (
    options.configuredHost ?? process.env.API_BIND_HOST ?? ''
  ).trim();

  if (local) {
    if (configured !== '' && configured !== '127.0.0.1') {
      throw new Error(
        'AGENT_LOCAL requires API_BIND_HOST=127.0.0.1; refusing a non-loopback primary API listener',
      );
    }
    return '127.0.0.1';
  }

  const host = configured || '0.0.0.0';
  if (
    host.includes('/') ||
    host.includes('\\') ||
    /\s/.test(host) ||
    (!validBindHostname(host) && isIP(host) === 0)
  ) {
    throw new Error(`Invalid API_BIND_HOST "${host}"`);
  }
  return host;
}

function parseDbClient(value: string): DbClient {
  if (value === 'sqlite' || value === 'postgres') {
    return value;
  }

  throw new Error(
    `Unsupported DB_CLIENT "${value}". Expected "sqlite" or "postgres".`,
  );
}

/**
 * #878 — command-approval mode. See command_approval.ts for the full
 * decision tree. `manual` is the safe DEFAULT; `off` must be explicitly set
 * (never activated by default or environment detection, per the issue).
 *   - `manual` — always prompt for dangerous (non-hardline) commands.
 *   - `smart`  — low-risk auto-approves, high-risk auto-denies, uncertain
 *               escalates to a manual prompt.
 *   - `off`    — no prompts for non-blocklisted commands. Trusted-automation
 *               only; the hardline blocklist is NEVER affected by this mode.
 */
export type ApprovalsMode = 'manual' | 'smart' | 'off';

function parseApprovalsMode(value: string): ApprovalsMode {
  if (value === 'manual' || value === 'smart' || value === 'off') {
    return value;
  }
  throw new Error(
    `Unsupported APPROVALS_MODE "${value}". Expected "manual", "smart", or "off".`,
  );
}

/**
 * Resolve the command-approval mode FRESH from process.env at call time (no
 * module-load snapshot) — mirrors `resolveMemoryVaultPath()`'s "read live"
 * convention. Needed because a test (or a future runtime config reload) must
 * be able to flip `APPROVALS_MODE` without a process restart; `env.approvalsMode`
 * below is a one-time snapshot for documentation/callers that don't need
 * live behavior.
 */
export function resolveApprovalsMode(): ApprovalsMode {
  const raw = (process.env.APPROVALS_MODE ?? '').trim().toLowerCase();
  return parseApprovalsMode(raw === '' ? 'manual' : raw);
}

const approvalsMode = resolveApprovalsMode();

/**
 * OCU-08 (#1049) — engine websearch tool config, resolved FRESH from
 * process.env at call time (so a test / late config can set it without a
 * process restart, mirroring resolveApprovalsMode). The engine's native
 * websearch tool reads `OPENCODE_WEBSEARCH_PROVIDER` (exa|parallel) plus a
 * provider-specific key env var (`EXA_API_KEY` / `PARALLEL_API_KEY`) — see
 * apps/opencode_fork/.../tool/websearch.ts. Rhythm reads a single provider +
 * key pair from its own env and maps it onto the correct engine env var at
 * spawn time.
 *
 * Returns `null` when unconfigured (no key) — the engine then spawns with no
 * websearch env delta (behaves exactly as before this issue). Never logs the
 * key.
 */
export function resolveWebsearchConfig(): {
  provider: 'exa' | 'parallel';
  apiKey: string;
  /** The engine env var the key must be exported as. */
  keyEnvVar: 'EXA_API_KEY' | 'PARALLEL_API_KEY';
} | null {
  const provider = (process.env.RHYTHM_WEBSEARCH_PROVIDER ?? '').trim().toLowerCase();
  const apiKey = (process.env.RHYTHM_WEBSEARCH_API_KEY ?? '').trim();
  if (!apiKey) return null;
  if (provider !== 'exa' && provider !== 'parallel') return null;
  return {
    provider,
    apiKey,
    keyEnvVar: provider === 'exa' ? 'EXA_API_KEY' : 'PARALLEL_API_KEY',
  };
}

/**
 * Optional sandbox/operator override for Deep Research runs. Model IDs may
 * contain slashes (for example, `openrouter/openrouter/free`).
 */
export function parseResearchModel(value = process.env.RHYTHM_RESEARCH_MODEL) {
  if (value === undefined || value.trim() === '') return null;
  const slash = value.indexOf('/');
  const providerID = value.slice(0, slash).trim();
  const modelID = value.slice(slash + 1).trim();
  if (slash <= 0 || !providerID || !modelID) {
    throw new Error(
      'Invalid RHYTHM_RESEARCH_MODEL. Expected a non-empty provider/modelId (for example, openrouter/openrouter/free).',
    );
  }
  return { providerID, modelID };
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  /** #755 — deployment role; see DeploymentRole above. Default 'all'. */
  role: deploymentRole,
  /**
   * #755 — single switch every agent-execution gate reads. True for the 'all'
   * and 'local' roles, false for 'cloud' and 'relay'. Keeping the policy in
   * one derived boolean means route registration, startup init, and Postgres
   * DDL all gate on the same condition. The relay never spawns the engine,
   * scheduler, WS gateway, or the 4002 mobile gateway — it serves the /relay
   * surface instead (docs/ai/plan-synology-relay.md).
   */
  agentExecutionEnabled:
    deploymentRole !== 'cloud' && deploymentRole !== 'relay',
  /** True only for the Synology relay container (RHYTHM_ROLE=relay). */
  isRelayRole: deploymentRole === 'relay',
  /**
   * Ordered uplink candidates the MAC dials to reach the relay (LAN first,
   * tunnel fallback). Empty = uplink disabled. Relay-role processes ignore it.
   */
  relayUrls: (process.env.RHYTHM_RELAY_URLS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0),
  /** Public relay base advertised by the Mac gateway to paired phones. */
  relayPublicUrl:
    (process.env.RHYTHM_RELAY_PUBLIC_URL ?? '').trim() || null,
  /** Cloud bearer the Mac's uplink presents to the relay (plan §2). */
  relayBearer: (process.env.RHYTHM_RELAY_BEARER ?? '').trim() || null,
  /** #1288 — additive Research Projects surfaces remain opt-in until launched. */
  researchProjectsEnabled:
    (process.env.RHYTHM_RESEARCH_PROJECTS_ENABLED ?? '')
      .trim()
      .toLowerCase() === 'true',
  /** C6 (#1448) — treatment-v2 ships disabled; when off it is never considered for promotion. */
  treatmentV2Enabled:
    (process.env.RHYTHM_TREATMENT_V2_ENABLED ?? '')
      .trim()
      .toLowerCase() === 'true',
  /** C6 (#1448) — calibration ships disabled; when off no calibration observations are persisted. */
  calibrationEnabled:
    (process.env.RHYTHM_CALIBRATION_ENABLED ?? '')
      .trim()
      .toLowerCase() === 'true',
  researchModel: parseResearchModel(),
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
  /**
   * Defensive origin/host enforcement for the loopback agent surface. Default
   * ON; only the explicit value "off" disables it for compatibility recovery.
   */
  agentOriginGuardEnabled:
    (process.env.RHYTHM_AGENT_ORIGIN_GUARD ?? '').trim().toLowerCase() !==
    'off',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleAuthClientId:
    process.env.GOOGLE_AUTH_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? '',
  googleAuthClientSecret:
    process.env.GOOGLE_AUTH_CLIENT_SECRET ?? '',
  googleMobileClientId: process.env.GOOGLE_MOBILE_CLIENT_ID ?? '',
  googleMobileRedirectUri: process.env.GOOGLE_MOBILE_REDIRECT_URI ?? '',
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
  agentLocal,
  /**
   * #1175 — primary API listener host. AGENT_LOCAL is always pinned to
   * 127.0.0.1 and refuses any broader override; authenticated deployments keep
   * the historical 0.0.0.0 default unless API_BIND_HOST is set.
   */
  apiBindHost: resolveApiBindHost({ agentLocal }),
  /**
   * #1175 — public verification material only. Flutter keeps the raw human
   * approval capability and P-256 private key in the signed app's Keychain.
   */
  humanApprovalCapabilitySha256:
    process.env.HUMAN_APPROVAL_CAPABILITY_SHA256 ?? '',
  humanApprovalPublicKey: process.env.HUMAN_APPROVAL_PUBLIC_KEY ?? '',
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
   *  Set via PROD_API_URL env var.  When absent, production task mirroring is skipped.
   *  #1054/#1056 reuse this SAME field as the org skill library's home
   *  (`<prodApiUrl>/org-skills`) — falls back to the Flutter apiBaseUrl default
   *  (https://api.vcrcapps.com) rather than skipping, since org-skill wiring
   *  should work out of the box on a fresh install. */
  prodApiUrl: process.env.PROD_API_URL ?? null,
  /** Bearer token to authenticate against the production API for task mirroring
   *  and (#1056) publishing an approved skill to the org library. */
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
  liveArtifactStorageDir: resolveLiveArtifactStorageDir(),
  /**
   * Issue #770 WI6: cron expression for the Memory-Vault mirror-sync job.
   * Defaults to every 10 minutes. Overridable via MEMORY_VAULT_SYNC_CRON.
   */
  memoryVaultSyncCron: process.env.MEMORY_VAULT_SYNC_CRON ?? '*/10 * * * *',
  /**
   * #868 — Apple-Silicon-native local inference provider (oMLX). OPTIONAL and
   * OFF by default: the manually-proven setup (oMLX 0.4.4 serving
   * `mlx-community/gpt-oss-20b-MXFP4-Q8` on an OpenAI-compatible loopback
   * endpoint) is only written into the generated opencode config when this
   * flag is explicitly enabled. This must never affect cloud/default profile
   * behavior — see `ensureOmlxProviderConfig()` in opencode_client_service.ts,
   * which is the single place this config is materialized.
   *
   * Only the literal string 'true' enables it (unset/anything else stays off) —
   * the inverse convention of the other feature flags above, because this one
   * gates a NEW opt-in capability (Apple-Silicon-only, requires the oMLX app
   * running locally) rather than narrowing an existing default-on behavior.
   */
  omlxProviderEnabled: (process.env.RHYTHM_LOCAL_OMLX_ENABLED ?? '').trim().toLowerCase() === 'true',
  /**
   * #868 — oMLX server endpoint. Always loopback-only by convention (the oMLX
   * app is a local Apple Silicon process); host/port are still overridable via
   * env rather than hardcoded so the generated config is never machine- or
   * port-assumption-specific. No secret is required for a loopback
   * OpenAI-compatible endpoint, so none is ever written into opencode.json.
   */
  omlxBaseUrl: process.env.RHYTHM_LOCAL_OMLX_BASE_URL ?? 'http://127.0.0.1:8000/v1',
  /**
   * #868 — model id oMLX is serving (must match what was loaded into the oMLX
   * server; e.g. `mlx-community/gpt-oss-20b-MXFP4-Q8` is loaded as
   * `gpt-oss-20b-MXFP4-Q8` in the OpenAI-compatible `/v1/models` listing).
   */
  omlxModelId: process.env.RHYTHM_LOCAL_OMLX_MODEL_ID ?? 'gpt-oss-20b-MXFP4-Q8',
  /** #868 — context window (tokens) for the oMLX model entry in opencode.json. */
  omlxContextLimit: Number(process.env.RHYTHM_LOCAL_OMLX_CONTEXT_LIMIT ?? 65536),
  /** #868 — max output tokens for the oMLX model entry in opencode.json. */
  omlxOutputLimit: Number(process.env.RHYTHM_LOCAL_OMLX_OUTPUT_LIMIT ?? 8192),
  /**
   * #868 — name of the competing local Ollama model to detect/unload before
   * the oMLX engine loads (a 32 GB Apple Silicon Mac cannot hold both an
   * ~23 GB Ollama model and the MLX model in memory at once). Matches the
   * `qwen3.6-work` Ollama model already wired in agent_model_resolver.ts.
   * Overridable via env since the exact local model name is a per-machine
   * choice, not a Rhythm constant.
   */
  omlxCompetingOllamaModel: process.env.RHYTHM_LOCAL_OMLX_OLLAMA_MODEL ?? 'qwen3.6-work',
  /** #878 — command-approval mode; see {@link ApprovalsMode}. Default 'manual'. */
  approvalsMode,
  /**
   * #878 — approval prompt timeout in seconds. On timeout: automatically deny
   * (fail-closed), per the issue. Default 60s, overridable via env.
   */
  approvalsTimeoutSeconds: Number(process.env.APPROVALS_TIMEOUT_SECONDS ?? 60),
};
