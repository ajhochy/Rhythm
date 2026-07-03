/**
 * #879 — Blank Slate mode config semantics.
 *
 * `rhythm setup --blank-slate` writes a Rhythm-owned `capabilities` block
 * into opencode.json (sibling to the engine's own `mcp`/`agent`/`provider`
 * blocks — see the real per-agent `tools` block precedent, e.g. the `local`
 * agent profile already disables `websearch`, `webfetch`, `skill`, `task`,
 * and every `<mcp>_*` tool with explicit `false` entries). This module
 * defines the CONTRACT for what "explicitly disabled" means and how it
 * survives a config merge — it does not itself talk to the filesystem (see
 * `blank_slate_mode.ts` for the writer, and `load_mcp_servers.ts` /
 * opencode_client_service.ts for how the engine reads `mcp[*].enabled`).
 *
 * Semantics (per the issue):
 *   - `true`      → explicitly enabled.
 *   - `false`     → explicitly disabled. A future merge/update MUST NOT flip
 *                   this back to `true` — the explicit `false` always wins.
 *   - `undefined` → unconfigured (never asked about). Distinct from
 *                   `false` for `rhythm doctor` reporting purposes (#871's
 *                   `CheckResult.status`: 'disabled' vs 'unconfigured').
 */

/** Capabilities that default ON even in Blank Slate mode (the minimal usable core). */
export const BLANK_SLATE_CORE_CAPABILITIES = [
  'aiProvider',
  'fileOps',
  'terminal',
] as const;

/** Capabilities Blank Slate mode writes as explicit `false`. */
export const BLANK_SLATE_DISABLED_CAPABILITIES = [
  'webSearch',
  'browserAutomation',
  'codeExecutionSandbox',
  'memoryCapture',
  'messagingIntegrations',
] as const;

export type CapabilityKey =
  | (typeof BLANK_SLATE_CORE_CAPABILITIES)[number]
  | (typeof BLANK_SLATE_DISABLED_CAPABILITIES)[number];

/** `true`/`false` = explicit; `undefined` (key absent) = unconfigured. */
export type CapabilitiesConfig = Partial<Record<CapabilityKey, boolean>>;

export interface RhythmConfig {
  /** Feature-flag-style capability toggles. Absent key = unconfigured (never `undefined` as a literal value — omit the key instead). */
  capabilities: CapabilitiesConfig;
  /** MCP server ids explicitly disabled (mirrors opencode.json's `mcp[*].enabled: false`, kept here too so `rhythm doctor` can report "disabled" vs "unconfigured" without re-deriving it from opencode.json's absence-means-unconfigured shape). */
  disabledMcpServers: string[];
  /** Skill ids explicitly enabled. In Blank Slate mode, anything NOT in this list is disabled. `null` means "no allowlist" (normal/non-Blank-Slate behavior — all installed skills active). */
  enabledSkills: string[] | null;
}

/** The config Blank Slate mode writes on a fresh install. */
export function blankSlateConfig(): RhythmConfig {
  const capabilities: CapabilitiesConfig = {};
  for (const key of BLANK_SLATE_CORE_CAPABILITIES) capabilities[key] = true;
  for (const key of BLANK_SLATE_DISABLED_CAPABILITIES) capabilities[key] = false;

  return {
    capabilities,
    disabledMcpServers: [],
    enabledSkills: [],
  };
}

/**
 * Merges an incoming config (e.g. from a Rhythm update that introduces new
 * default-on capabilities) into an existing one, honoring the "explicit
 * `false` always wins" rule: any key the existing config has set to `false`
 * stays `false` even if the incoming config wants to default it to `true`.
 * Keys unconfigured in the existing config take the incoming value
 * (this is how a legitimately NEW capability becomes available after an
 * update — it was never explicitly touched, so there is nothing to protect).
 */
export function mergeRhythmConfig(
  existing: RhythmConfig,
  incoming: Partial<RhythmConfig>,
): RhythmConfig {
  const capabilities: CapabilitiesConfig = { ...incoming.capabilities };
  for (const [key, value] of Object.entries(existing.capabilities) as [CapabilityKey, boolean][]) {
    if (value === false) {
      // Explicit disable always wins, regardless of what the incoming config says.
      capabilities[key] = false;
    } else if (value === true) {
      // An explicit enable is also a deliberate user choice; keep it unless
      // the incoming config doesn't mention the key at all.
      if (!(key in (incoming.capabilities ?? {}))) {
        capabilities[key] = true;
      }
    }
  }

  const disabledMcpServers = Array.from(
    new Set([...(existing.disabledMcpServers ?? []), ...(incoming.disabledMcpServers ?? [])]),
  );

  // enabledSkills: an existing allowlist (non-null) is a Blank-Slate-style
  // deliberate restriction; it survives the merge. `null` (no restriction)
  // is replaced by whatever the incoming config specifies.
  const enabledSkills =
    existing.enabledSkills !== null ? existing.enabledSkills : (incoming.enabledSkills ?? null);

  return { capabilities, disabledMcpServers, enabledSkills };
}

export type CapabilityStatus = 'enabled' | 'disabled' | 'unconfigured';

/** Classifies a capability's status for `rhythm doctor` reporting (#871 CheckResult.status mapping: enabled->'ok', disabled->'disabled', unconfigured->'unconfigured'). */
export function capabilityStatus(config: RhythmConfig, key: CapabilityKey): CapabilityStatus {
  const value = config.capabilities[key];
  if (value === true) return 'enabled';
  if (value === false) return 'disabled';
  return 'unconfigured';
}
