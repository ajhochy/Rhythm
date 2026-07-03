/**
 * command_risk_classifier.ts — Issue #878
 *
 * Local, deterministic risk classifier for shell commands that are NOT on the
 * hardline blocklist (command_blocklist.ts always wins ahead of this). Used
 * by `smart` approval mode to auto-approve low-risk commands, auto-deny
 * high-risk ones, and escalate anything uncertain to a manual prompt.
 *
 * Per the issue's data-safety constraint, this is a LOCAL heuristic
 * classifier — NOT a network call to an unauthenticated endpoint. (A future
 * iteration could route "uncertain" through the already-authenticated model
 * session, but that is out of scope for this issue; escalating to a manual
 * prompt is the safe default here.)
 *
 * PURE: no I/O.
 */

export type RiskTier = 'low' | 'high' | 'uncertain';

interface RiskPattern {
  id: string;
  description: string;
  regex: RegExp;
  tier: RiskTier;
}

/**
 * High-risk-but-not-hardline commands named explicitly in the issue body:
 * force-pushing, hard-resetting, and destructive SQL. These are NOT on the
 * unconditional blocklist (a legitimate workflow may need them with
 * confirmation) but must never auto-approve under `smart` mode.
 */
const HIGH_RISK_PATTERNS: RiskPattern[] = [
  {
    id: 'git-push-force',
    description: 'git push --force (or -f) — rewrites remote history',
    regex: /\bgit\s+push\b[^\n]*(--force\b|-f\b)/i,
    tier: 'high',
  },
  {
    id: 'git-reset-hard',
    description: 'git reset --hard — discards local uncommitted work',
    regex: /\bgit\s+reset\s+--hard\b/i,
    tier: 'high',
  },
  {
    id: 'sql-drop',
    description: 'DROP TABLE/DATABASE/SCHEMA — destructive SQL DDL',
    regex: /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
    tier: 'high',
  },
  {
    id: 'dd-generic',
    description: 'dd to a block device (not already hardline-blocked)',
    regex: /\bdd\s+[^\n]*of=\/dev\//i,
    tier: 'high',
  },
];

/**
 * Low-risk allowlist: common read-only / informational commands. Kept
 * intentionally small and conservative — this is an allowlist of SAFE
 * prefixes, not a denylist, so anything not recognized here falls through to
 * 'uncertain' rather than being assumed safe.
 */
const LOW_RISK_PATTERNS: RiskPattern[] = [
  { id: 'ls', description: 'list directory contents', regex: /^\s*ls\b/i, tier: 'low' },
  { id: 'pwd', description: 'print working directory', regex: /^\s*pwd\b/i, tier: 'low' },
  { id: 'cat', description: 'print file contents', regex: /^\s*cat\b/i, tier: 'low' },
  { id: 'git-status', description: 'git status/log/diff (read-only)', regex: /^\s*git\s+(status|log|diff|show|branch)\b/i, tier: 'low' },
  { id: 'npm-test', description: 'npm/yarn test or lint', regex: /^\s*(npm|yarn|pnpm)\s+(test|run\s+lint|lint)\b/i, tier: 'low' },
  { id: 'echo', description: 'echo (no side effects)', regex: /^\s*echo\b/i, tier: 'low' },
  { id: 'grep', description: 'grep/rg search (read-only)', regex: /^\s*(grep|rg)\b/i, tier: 'low' },
];

/**
 * DELETE FROM without a WHERE clause wipes an entire table. A single regex
 * can't express "no WHERE anywhere in THIS statement" (a WHERE clause could
 * legitimately appear on an unrelated later statement or an unrelated later
 * word in the same shell line), so this scans just the statement's own
 * extent (up to the next `;` or closing quote, or end of string).
 */
function isDeleteWithoutWhere(command: string): boolean {
  const m = /\bDELETE\s+FROM\s+\S+/i.exec(command);
  if (!m) return false;
  const rest = command.slice(m.index);
  const stmtEndIdx = rest.search(/[;"]/);
  const statement = stmtEndIdx === -1 ? rest : rest.slice(0, stmtEndIdx);
  return !/\bWHERE\b/i.test(statement);
}

/**
 * Classify `command` into a risk tier. Order: high-risk patterns first (a
 * command must never be misclassified as low-risk if it also happens to
 * start with a safe-looking prefix), then low-risk, then 'uncertain'.
 */
export function classifyCommandRisk(command: string): RiskTier {
  for (const p of HIGH_RISK_PATTERNS) {
    if (p.regex.test(command)) return 'high';
  }
  if (isDeleteWithoutWhere(command)) return 'high';
  for (const p of LOW_RISK_PATTERNS) {
    if (p.regex.test(command)) return 'low';
  }
  return 'uncertain';
}
