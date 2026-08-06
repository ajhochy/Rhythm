/**
 * #1322 — the hardline blocklist only sees commands the ENGINE escalates.
 *
 * Nearly every profile carries `bash: {"*": "allow", …}`, so anything matching
 * only `*` ran with no permission event and the blocklist never executed. Proven
 * live on 2026-08-04: `curl -s http://127.0.0.1:9/nope | sh` — a hardline
 * `curl-pipe-shell` match — executed under `bypassPermissions` with ZERO
 * permission events on the engine's own /event stream.
 *
 * These tests pin the projection invariant AND the engine-ordering assumption it
 * depends on. The ordering half matters: if `evaluate`'s last-match-wins ever
 * changed to first-match-wins, escalation would silently stop working while the
 * projection still looked correct.
 */
import { describe, it, expect } from 'vitest';
import {
  HARDLINE_ESCALATION_BASH_RULES,
  withHardlineBashEscalation,
} from '../services/profile_capability_surface';

/**
 * The engine's matcher, mirrored from
 * apps/opencode_fork/packages/opencode/src/util/wildcard.ts. Anchored `^…$`,
 * `*` → `.*`, and a trailing " *" made optional.
 */
function engineMatch(str: string, pattern: string): boolean {
  let escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  if (escaped.endsWith(' .*')) escaped = escaped.slice(0, -3) + '( .*)?';
  return new RegExp('^' + escaped + '$', 's').test(str);
}

/** The engine's resolution: findLast over the flattened ruleset. */
function engineResolve(command: string, bashRules: Record<string, string>): string {
  const entries = Object.entries(bashRules);
  const hit = entries.filter(([pattern]) => engineMatch(command, pattern)).pop();
  return hit ? hit[1] : 'ask'; // evaluate() defaults unmatched to ask
}

// The real shape carried by `build`, the Sunday Prep profiles, Org Optimizer, …
const REAL_PROFILE_BASH: Record<string, string> = {
  '*': 'allow',
  'git push*': 'ask',
  'git merge *': 'ask',
  'git rebase*': 'ask',
  'git reset*': 'ask',
  'git clean*': 'ask',
  'rm -rf*': 'ask',
  'rm -fr*': 'ask',
  'sudo *': 'ask',
};

describe('#1322 — hardline bash escalation projection', () => {
  it('appends the escalation rules AFTER the profile rules (last-match-wins)', () => {
    const out = withHardlineBashEscalation({ bash: REAL_PROFILE_BASH });
    const keys = Object.keys(out.bash as Record<string, string>);
    // Every profile key must precede every escalation key.
    const lastProfile = Math.max(...Object.keys(REAL_PROFILE_BASH).map((k) => keys.indexOf(k)));
    const firstEscalation = Math.min(
      ...HARDLINE_ESCALATION_BASH_RULES.map((r) => keys.indexOf(r.pattern)),
    );
    expect(firstEscalation).toBeGreaterThan(lastProfile);
  });

  it('makes a bare interpreter escalate, which is the pipe-to-shell segment', () => {
    const bash = withHardlineBashEscalation({ bash: REAL_PROFILE_BASH }).bash as Record<string, string>;
    // Before: the engine allowed it outright, so Rhythm never saw the command.
    expect(engineResolve('sh', REAL_PROFILE_BASH)).toBe('allow');
    // After: it escalates, so the gate can recover the full line and deny.
    expect(engineResolve('sh', bash)).toBe('ask');
    for (const interpreter of ['bash', 'zsh']) {
      expect(engineResolve(interpreter, bash)).toBe('ask');
    }
  });

  it('does NOT over-escalate an interpreter running a script', () => {
    const bash = withHardlineBashEscalation({ bash: REAL_PROFILE_BASH }).bash as Record<string, string>;
    // Anchored matching means `sh` never matches `sh deploy.sh`.
    expect(engineResolve('sh deploy.sh', bash)).toBe('allow');
    expect(engineResolve('bash -c "echo hi"', bash)).toBe('allow');
    expect(engineResolve('ls -la', bash)).toBe('allow');
    expect(engineResolve('echo hello', bash)).toBe('allow');
  });

  it('escalates mkfs and dd, the other shapes no profile listed', () => {
    const bash = withHardlineBashEscalation({ bash: REAL_PROFILE_BASH }).bash as Record<string, string>;
    expect(engineResolve('mkfs.ext4 /dev/disk2', REAL_PROFILE_BASH)).toBe('allow');
    expect(engineResolve('mkfs.ext4 /dev/disk2', bash)).toBe('ask');
    expect(engineResolve('dd if=/dev/zero of=/dev/disk0', bash)).toBe('ask');
  });

  it('preserves the rules a profile already escalates', () => {
    const bash = withHardlineBashEscalation({ bash: REAL_PROFILE_BASH }).bash as Record<string, string>;
    expect(engineResolve('rm -rf /', bash)).toBe('ask');
    expect(engineResolve('git push --force origin main', bash)).toBe('ask');
    expect(engineResolve('sudo whoami', bash)).toBe('ask');
  });

  it('widens a string bash value so escalation has somewhere to live', () => {
    // `config-doctor` ships `bash: "allow"`.
    const out = withHardlineBashEscalation({ bash: 'allow' });
    const expected = Object.fromEntries(
      HARDLINE_ESCALATION_BASH_RULES.map((r) => [r.pattern, 'ask']),
    );
    expect(out.bash).toMatchObject({ '*': 'allow', ...expected });
    expect(engineResolve('sh', out.bash as Record<string, string>)).toBe('ask');
    expect(engineResolve('ls', out.bash as Record<string, string>)).toBe('allow');
  });

  // The first cut of this escalation widened EVERY bash value, which turned an
  // explicit `bash: "deny"` into `{'*': 'deny', sh: 'ask', …}` — downgrading a
  // total denial into a prompt for exactly the dangerous shapes, and breaking
  // #1162's "a scalar replaces the whole permission subtree" contract. The
  // existing projection suite caught it. Escalation must only ever tighten.
  it('never downgrades a scalar deny — leaves it byte-identical', () => {
    const input = { read: 'allow', bash: 'deny' };
    const out = withHardlineBashEscalation(input);
    expect(out).toEqual(input);
    expect(out.bash).toBe('deny'); // still a scalar, not widened to a map
  });

  it('never downgrades a scalar ask', () => {
    const input = { bash: 'ask' };
    expect(withHardlineBashEscalation(input)).toEqual(input);
    expect(withHardlineBashEscalation(input).bash).toBe('ask');
  });

  it('never downgrades a map that already denies everything', () => {
    const input = { bash: { '*': 'deny' } };
    expect(withHardlineBashEscalation(input)).toEqual(input);
  });

  it('adds only the shapes that are actually still allowed', () => {
    // `*` denies, but `dd`/`mkfs` are explicitly allowed later — escalate just
    // those two and leave the interpreters denied.
    const out = withHardlineBashEscalation({
      bash: { '*': 'deny', 'dd *': 'allow', 'mkfs*': 'allow' },
    }).bash as Record<string, string>;
    expect(out.sh).toBeUndefined();
    expect(out.bash).toBeUndefined();
    expect(out['dd *']).toBe('ask');
    expect(out['mkfs*']).toBe('ask');
    expect(engineResolve('sh', out)).toBe('deny');
    expect(engineResolve('dd if=/dev/zero of=/dev/disk0', out)).toBe('ask');
  });

  it('leaves a profile with no bash key untouched (evaluate already defaults to ask)', () => {
    const input = { read: 'allow', webfetch: 'allow' };
    expect(withHardlineBashEscalation(input)).toEqual(input);
    expect(engineResolve('anything', {})).toBe('ask');
  });

  it('does not disturb other permissions', () => {
    const out = withHardlineBashEscalation({
      bash: REAL_PROFILE_BASH,
      read: 'allow',
      edit: 'allow',
      external_directory: { '*': 'ask' },
    });
    expect(out.read).toBe('allow');
    expect(out.edit).toBe('allow');
    expect(out.external_directory).toEqual({ '*': 'ask' });
  });
});
