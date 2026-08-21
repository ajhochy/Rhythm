/**
 * D1.2/D1.3 (#1427/#1428) — the closed registry of tool-invocation test
 * scenarios a `tool-install` proposal may select.
 *
 * The global contract forbids raw prompt bodies in durable state. A
 * `tool-install` proposal's `change_json.testPrompts` therefore never
 * carries prompt TEXT — it carries 2 or 3 identifiers from THIS closed,
 * code-owned registry. The actual CLI args a scenario resolves to are
 * fixed here and only ever read at sandbox runtime
 * ({@link tool_sandbox_vetter.ts}); an unrecognised identifier is refused
 * by {@link isToolTestScenarioId} without ever being echoed back — see
 * `tool_install_proposal_validator.ts` and `tool_sandbox_vetter.ts`, both
 * of which import this same closed set so the proposal-time contract and
 * the runtime behavior can never drift apart.
 */

export interface ToolTestScenario {
  /** Fixed, non-sensitive CLI arguments passed to the installed candidate. */
  readonly args: readonly string[];
}

export const TOOL_TEST_SCENARIOS: Readonly<Record<string, ToolTestScenario>> = {
  'version-check': { args: ['--version'] },
  'help-check': { args: ['--help'] },
  'stdin-noop': { args: [] },
};

export const TOOL_TEST_SCENARIO_IDS: readonly string[] = Object.keys(TOOL_TEST_SCENARIOS);

export function isToolTestScenarioId(value: unknown): value is string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TOOL_TEST_SCENARIOS, value);
}

/** A `tool-install` proposal must select between 2 and 3 distinct scenarios — never fewer, never more. */
export const TOOL_INSTALL_MIN_TEST_SCENARIOS = 2;
export const TOOL_INSTALL_MAX_TEST_SCENARIOS = 3;
