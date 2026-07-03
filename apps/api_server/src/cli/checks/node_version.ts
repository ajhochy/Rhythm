import type { CheckResult } from './types';

/**
 * #871 — Node engine readiness. No `semver` dependency is available in this
 * package (and CLAUDE.md forbids installing new deps in this worktree), so
 * this implements a minimal parser for the simple space-separated
 * `>=X <Y` / `>=X` style ranges used in this repo's `package.json#engines`.
 * It intentionally does not attempt to support the full semver range
 * grammar (caret/tilde/OR) — those are not used here.
 */
export function parseNodeMajor(version: string): number | null {
  const match = version.trim().match(/^v?(\d+)/);
  if (!match) return null;
  return Number(match[1]);
}

interface RangeClause {
  op: '>=' | '<=' | '>' | '<';
  major: number;
}

function parseEnginesRange(range: string): RangeClause[] {
  const clauses: RangeClause[] = [];
  for (const token of range.trim().split(/\s+/)) {
    const match = token.match(/^(>=|<=|>|<)(\d+)/);
    if (match) {
      clauses.push({ op: match[1] as RangeClause['op'], major: Number(match[2]) });
    }
  }
  return clauses;
}

function satisfies(major: number, clauses: RangeClause[]): boolean {
  return clauses.every((clause) => {
    switch (clause.op) {
      case '>=':
        return major >= clause.major;
      case '<=':
        return major <= clause.major;
      case '>':
        return major > clause.major;
      case '<':
        return major < clause.major;
    }
  });
}

export interface CheckNodeVersionOptions {
  /** Defaults to `process.version` (e.g. "v20.14.0"). */
  nodeVersion?: string;
  /** Defaults to reading `engines.node` from this package's package.json. */
  enginesRange?: string;
}

export function checkNodeVersion(options: CheckNodeVersionOptions = {}): CheckResult {
  const label = 'Node.js version';
  const nodeVersion = options.nodeVersion ?? process.version;
  const enginesRange =
    options.enginesRange ??
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require('../../../package.json') as { engines?: { node?: string } }).engines?.node;

  const major = parseNodeMajor(nodeVersion);
  if (major === null) {
    return {
      label,
      pass: false,
      remediation: `Could not determine your Node.js version from "${nodeVersion}". Install a supported Node.js version.`,
    };
  }

  if (!enginesRange) {
    // No declared range to check against — treat as informational pass.
    return { label, pass: true };
  }

  const clauses = parseEnginesRange(enginesRange);
  const ok = satisfies(major, clauses);

  return {
    label,
    pass: ok,
    remediation: ok
      ? undefined
      : `Node.js ${nodeVersion} does not satisfy the required range "${enginesRange}". Install a supported Node.js version (e.g. via nvm).`,
  };
}
