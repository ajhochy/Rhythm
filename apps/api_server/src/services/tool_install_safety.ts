/**
 * D1.2/D1.3 (#1427/#1428) — shared shape safety for the two caller-controlled
 * strings that get interpolated into a shell command anywhere in the D1
 * tool-vetting track: `toolName` (the executable invoked inside the
 * sandbox for each test scenario) and `packageSource` (the install target).
 *
 * Both `tool_install_proposal_validator.ts` (durable proposal-apply gate)
 * and `tool_sandbox_vetter.ts` (the sandbox that actually builds the shell
 * command) import these SAME predicates so the two can never drift — a
 * value the validator accepts is guaranteed to be safe for the vetter to
 * interpolate, and vice versa.
 */

/** Safe executable identifiers: no shell metacharacters, no path traversal. */
const SAFE_TOOL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isSafeToolName(value: unknown): value is string {
  return typeof value === 'string' && SAFE_TOOL_NAME_PATTERN.test(value);
}

/** Safe package identifiers for npm/pip: no shell metacharacters (scoped npm names and version pins allowed). */
const SAFE_PACKAGE_SOURCE_PATTERN = /^[A-Za-z0-9_@/.:^~+-]{1,256}$/;

export function isSafePackageSource(value: unknown): value is string {
  return typeof value === 'string' && SAFE_PACKAGE_SOURCE_PATTERN.test(value);
}
