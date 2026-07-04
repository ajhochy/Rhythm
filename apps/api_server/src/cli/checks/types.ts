/**
 * #871 — shared contract for every `rhythm doctor` check.
 *
 * A check is a standalone async function — no side-effectful imports of
 * `server.ts` or any Express app bootstrap. Each check inspects the
 * environment (env vars, config files, network reachability) and returns a
 * `CheckResult` describing what it found. Checks NEVER print anything
 * themselves (no `console.log`) and NEVER include secret VALUES in their
 * output — presence/validity only.
 */
export interface CheckResult {
  /** Human-readable label, not a code — e.g. "Anthropic API key". */
  label: string;
  /** Whether the check passed. */
  pass: boolean;
  /**
   * Plain-English remediation step, required when `pass` is false.
   * Omitted (or ignored) when `pass` is true.
   */
  remediation?: string;
  /**
   * #879 — distinguishes a capability the user explicitly turned off
   * (Blank Slate `false` entries) from one that simply was never configured.
   * Absent/undefined means "not applicable" (most checks: pass/fail only).
   */
  status?: 'ok' | 'unconfigured' | 'disabled';
}

export type CheckFn = () => Promise<CheckResult[]> | CheckResult[];
