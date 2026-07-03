import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';
import { env } from '../config/env';

/**
 * Minimal local mirror of opencode's `permission` config shape (see
 * `apps/opencode_fork/packages/opencode/src/config/permission.ts`). Rhythm
 * does NOT import from `apps/opencode_fork` (it is a vendored subtree, not a
 * build dependency — see AGENTS.md), so this is a narrow structural type
 * covering only the keys `buildLocalAgentPermission()` actually writes.
 * `opencode.json` is plain data either way; this type exists purely for
 * compile-time safety on the values Rhythm generates.
 */
export type PermissionAction = 'ask' | 'allow' | 'deny';
export type LocalAgentPermission = Record<string, PermissionAction>;

/**
 * #868 — Apple-Silicon-native local inference provider (oMLX).
 *
 * Productionizes a manually-proven setup: oMLX 0.4.4 serving
 * `mlx-community/gpt-oss-20b-MXFP4-Q8` on an OpenAI-compatible loopback
 * endpoint (`http://127.0.0.1:8000/v1`), registered as an opencode `provider`
 * entry via the generic `@ai-sdk/openai-compatible` loader (the same
 * mechanism the existing Ollama provider uses — see the `ollama` entry in
 * `KEYLESS_LOCAL_PROVIDER_IDS` / `ROUTE_FALLBACKS_BY_AGENT.opencode` in
 * `agent_model_resolver.ts`), plus a CONSTRAINED `local` agent profile whose
 * tool surface is narrow enough that the tool-schema prefill doesn't OOM
 * Metal on a 32 GB machine (~9K tokens vs ~136K for the full Rhythm tool
 * surface — Qwen3-Coder-30B was rejected in manual testing for a related
 * reason: it emitted textual `<function=...>` markup instead of structured
 * tool calls, which is why {@link buildLocalAgentPermission} exists alongside
 * a structured-tool-call smoke test rather than relying on plain text-gen
 * success).
 *
 * OPTIONAL by design (#868 acceptance criteria):
 *   - Gated behind `env.omlxProviderEnabled` (RHYTHM_LOCAL_OMLX_ENABLED=true).
 *     When disabled (the default), this module never touches opencode.json —
 *     cloud/default profiles are completely unaffected.
 *   - `local` is a normal, explicitly-selectable agent profile once written —
 *     it is NEVER made the default agent for any existing route (see
 *     `agent_model_resolver.ts`: `omlx` never appears before the cloud routes,
 *     mirroring the existing Ollama-is-fallback-only convention).
 *   - No secret is ever written — a loopback OpenAI-compatible endpoint needs
 *     none, matching the existing curated-MCP contract of never serializing
 *     credentials into the generated config unless a real secret exists.
 *
 * Non-machine-specific (#868 acceptance criteria): every value that could
 * vary per machine (endpoint host/port, model id, context/output limits, the
 * competing Ollama model to unload) is read from `env` (itself sourced from
 * process.env with documented defaults) — never a literal username or home
 * directory. `homedir()` is used only to locate the shared opencode config
 * file path, exactly like every other config-patching function in this
 * codebase (`ensureGeminiProjectConfig`, `ensureRhythmMcp`, …).
 */

/** Config-file provider id for the oMLX loader entry (`provider.omlx`). */
export const OMLX_PROVIDER_ID = 'omlx';

/** Config-file agent id for the constrained local coding profile (`agent.local`). */
export const OMLX_LOCAL_AGENT_ID = 'local';

export interface EnsureOmlxProviderConfigResult {
  changed: boolean;
  enabled: boolean;
  providerId: string;
  modelId: string;
  agentId: string;
}

/**
 * Build the constrained tool-surface permission block for the `local` agent
 * profile.
 *
 * #868 acceptance criteria: "expose only read/search/edit/patch/bash; MCP,
 * skill, subagent (task), and web (webfetch/websearch) disabled" — dropping
 * the tool-schema prefill from ~136K to ~9K tokens (the full Rhythm MCP
 * surface is what OOMs Metal on a 32 GB machine, not the coding tools
 * themselves).
 *
 * Uses opencode's own `permission` schema (see
 * apps/opencode_fork/packages/opencode/src/config/permission.ts) — `edit`
 * covers write/edit/patch as one rule (the fork's `ConfigAgent.normalize`
 * collapses those three legacy `tools` keys into `permission.edit`), so this
 * function writes `permission` directly rather than the deprecated `tools`
 * map. Bash and the read-family tools (read/glob/grep/list) are explicitly
 * allowed; task/webfetch/websearch/skill are explicitly denied. Every
 * `<mcpServerName>_*` wildcard is denied via the schema's catch-all record
 * entry so no MCP server surface leaks into the prefill regardless of what a
 * user has installed.
 */
export function buildLocalAgentPermission(): LocalAgentPermission {
  return {
    read: 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    edit: 'allow',
    bash: 'allow',
    task: 'deny',
    webfetch: 'deny',
    websearch: 'deny',
    skill: 'deny',
    // Catch-all: any MCP tool name (namespaced `<server>_<tool>` by opencode
    // convention) is denied. This is a documentation/defense-in-depth entry —
    // the `local` agent profile is never given an `allowed_mcps_json` scope in
    // the first place, but an explicit deny here means a future MCP server
    // addition can never silently reappear in this profile's tool list.
    '*': 'deny',
  };
}

/**
 * Idempotently ensure the oMLX provider + constrained `local` agent are
 * registered in opencode.json.
 *
 * Behavior (mirrors `ensureGeminiProjectConfig`'s contract):
 *   - `env.omlxProviderEnabled` is false (default) → no-op, `changed: false`.
 *     This is the OPTIONAL/feature-flag gate — cloud/default profiles are
 *     never touched when the flag is off.
 *   - Missing config file → starts from `{}` and writes both blocks.
 *   - Parse error → logs and returns WITHOUT writing (never clobbers a
 *     hand-edited config).
 *   - Already correct → no write (idempotent), `changed: false`.
 *   - Different/missing → sets it, creating `provider.omlx` / `agent.local`
 *     as needed, WITHOUT touching any other provider/agent entry.
 *
 * Never throws — a write failure is logged and treated as `changed: false`
 * so it can never block engine startup (same posture as every other
 * opencode.json patcher in this codebase).
 */
export function ensureOmlxProviderConfig(opts?: {
  configPath?: string;
  enabled?: boolean;
}): EnsureOmlxProviderConfigResult {
  const enabled = opts?.enabled ?? env.omlxProviderEnabled;
  const providerId = OMLX_PROVIDER_ID;
  const modelId = env.omlxModelId;
  const agentId = OMLX_LOCAL_AGENT_ID;

  if (!enabled) {
    return { changed: false, enabled: false, providerId, modelId, agentId };
  }

  const configPath =
    opts?.configPath ?? join(homedir(), '.config', 'opencode', 'opencode.json');

  let parsed: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      const raw = JSON.parse(readFileSync(configPath, 'utf8'));
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        parsed = raw;
      }
    } catch (err) {
      logger.warn(
        `[LocalOmlxProvider] could not parse opencode.json at ${configPath} — leaving it untouched: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { changed: false, enabled, providerId, modelId, agentId };
    }
  }

  const desiredProviderEntry = {
    npm: '@ai-sdk/openai-compatible',
    name: 'oMLX (local, Apple Silicon)',
    options: { baseURL: env.omlxBaseUrl },
    models: {
      [modelId]: {
        name: `${modelId} (Local)`,
        limit: {
          context: env.omlxContextLimit,
          output: env.omlxOutputLimit,
        },
      },
    },
  };

  const desiredAgentEntry = {
    description:
      'Local coding agent (oMLX / Apple Silicon) — constrained tool surface for practical on-device prefill.',
    mode: 'primary' as const,
    model: `${providerId}/${modelId}`,
    permission: buildLocalAgentPermission(),
  };

  const provider = (parsed.provider as Record<string, unknown> | undefined) ?? {};
  const agent = (parsed.agent as Record<string, unknown> | undefined) ?? {};

  const providerUnchanged =
    JSON.stringify(provider[providerId] ?? null) === JSON.stringify(desiredProviderEntry);
  const agentUnchanged =
    JSON.stringify(agent[agentId] ?? null) === JSON.stringify(desiredAgentEntry);

  if (providerUnchanged && agentUnchanged) {
    return { changed: false, enabled, providerId, modelId, agentId };
  }

  provider[providerId] = desiredProviderEntry;
  agent[agentId] = desiredAgentEntry;
  parsed.provider = provider;
  parsed.agent = agent;

  try {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  } catch (err) {
    logger.warn(
      `[LocalOmlxProvider] could not write opencode.json at ${configPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { changed: false, enabled, providerId, modelId, agentId };
  }

  logger.info(
    `[LocalOmlxProvider] ensured oMLX provider (${providerId}/${modelId}) + constrained '${agentId}' agent profile in opencode.json`,
  );
  return { changed: true, enabled, providerId, modelId, agentId };
}

// ─────────────────────────────────────────────────────────────────────────
// #868 — Ollama/oMLX memory-coexistence guard
//
// A 32 GB Apple Silicon Mac cannot hold both a large Ollama model (~23 GB for
// the `qwen3.6-work` model already wired in agent_model_resolver.ts) and the
// oMLX model in memory at once — both are Metal-resident. Before oMLX loads,
// Rhythm must detect a competing Ollama model and either unload it
// automatically or surface the exact action (`ollama stop <model>`) a human
// needs to take.
// ─────────────────────────────────────────────────────────────────────────

/** Injectable process-running dependency so this is unit-testable without a real Ollama install. */
export interface OllamaProcessRunner {
  run: (file: string, args: string[]) => Promise<string>;
}

const defaultOllamaProcessRunner: OllamaProcessRunner = {
  run: async (file, args) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execFile } = require('child_process') as typeof import('child_process');
    const { promisify } = require('util') as typeof import('util');
    const { stdout } = await promisify(execFile)(file, args);
    return stdout;
  },
};

export interface OllamaUnloadResult {
  /** True when a competing model was found running via `ollama ps`. */
  detected: boolean;
  /** The model name that was found/targeted (env.omlxCompetingOllamaModel). */
  model: string;
  /** True when this call actually issued `ollama stop <model>` successfully. */
  unloaded: boolean;
  /** Human-readable action the caller should surface when auto-unload isn't possible/requested. */
  action: string;
  /** Set when detection or unload failed for a reason other than "not running". */
  error?: string;
}

/**
 * Parse `ollama ps` output for whether `modelName` is currently loaded.
 *
 * `ollama ps` prints a header line + one row per running model, first column
 * is the model name (e.g. `qwen3.6-work:latest`). Matching is prefix-based on
 * `modelName` (before any `:tag`) so a caller doesn't have to know the exact
 * tag Ollama reports.
 */
export function parseOllamaPsForModel(psOutput: string, modelName: string): boolean {
  const lines = psOutput.split('\n').slice(1); // drop header
  return lines.some((line) => {
    const firstCol = line.trim().split(/\s+/)[0];
    if (!firstCol) return false;
    const base = firstCol.split(':')[0];
    return base === modelName;
  });
}

/**
 * Detect whether the configured competing Ollama model
 * (`env.omlxCompetingOllamaModel`) is currently loaded, and — when
 * `autoUnload` is true (default) — unload it via `ollama stop <model>` so the
 * oMLX engine can load without contending for the same Metal memory.
 *
 * When `autoUnload` is false, or the `ollama` binary/CLI call fails for any
 * reason, this NEVER throws: it degrades to `unloaded: false` and returns a
 * human-readable `action` string (`ollama stop <model>`) so the caller (a
 * startup log line, or a UI banner) can surface the required manual step.
 * This satisfies the #868 acceptance criteria ("at minimum surface the
 * required `ollama stop <model>` action; better, automate the detect+unload")
 * without ever blocking oMLX/engine startup on Ollama being uninstalled or
 * unreachable.
 */
export async function detectAndUnloadCompetingOllamaModel(opts?: {
  autoUnload?: boolean;
  runner?: OllamaProcessRunner;
  model?: string;
}): Promise<OllamaUnloadResult> {
  const model = opts?.model ?? env.omlxCompetingOllamaModel;
  const autoUnload = opts?.autoUnload ?? true;
  const runner = opts?.runner ?? defaultOllamaProcessRunner;
  const action = `ollama stop ${model}`;

  let psOutput: string;
  try {
    psOutput = await runner.run('ollama', ['ps']);
  } catch (err) {
    // Ollama not installed / not running / CLI error — nothing competing for
    // memory from Rhythm's point of view. Not an error condition worth
    // surfacing (Ollama being absent is the common case on a fresh machine).
    logger.info(
      `[LocalOmlxProvider] 'ollama ps' unavailable (Ollama likely not installed/running) — skipping unload check: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { detected: false, model, unloaded: false, action };
  }

  const detected = parseOllamaPsForModel(psOutput, model);
  if (!detected) {
    return { detected: false, model, unloaded: false, action };
  }

  if (!autoUnload) {
    logger.warn(
      `[LocalOmlxProvider] competing Ollama model '${model}' is loaded — manual action required: ${action}`,
    );
    return { detected: true, model, unloaded: false, action };
  }

  try {
    await runner.run('ollama', ['stop', model]);
    logger.info(`[LocalOmlxProvider] unloaded competing Ollama model '${model}' before starting oMLX`);
    return { detected: true, model, unloaded: true, action };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn(
      `[LocalOmlxProvider] failed to auto-unload Ollama model '${model}' (${error}) — manual action required: ${action}`,
    );
    return { detected: true, model, unloaded: false, action, error };
  }
}
