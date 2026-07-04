/**
 * command_blocklist.ts — Issue #878
 *
 * Hardline, non-overridable shell-command blocklist. These patterns are
 * ALWAYS blocked regardless of `approvals.mode` (manual/smart/off) or any
 * user approval — no mode and no "always allow" entry can unblock them.
 * Kept in its own file (separate from the approval flow / risk classifier)
 * so the list is easy to review in isolation, per the issue's file layout.
 *
 * PURE: no I/O. Mirrors mcp_dispatch_guard.ts's pure-predicate style.
 */

export interface BlocklistPattern {
  id: string;
  description: string;
  regex: RegExp;
}

/**
 * Each pattern is deliberately narrow enough to avoid over-blocking a
 * superficially-similar but harmless command (issue's "partial match" edge
 * case), while still catching the documented variants.
 */
export const HARDLINE_BLOCKLIST: BlocklistPattern[] = [
  {
    id: 'rm-rf-root',
    description: 'rm -rf targeting / or a home/wildcard root',
    // Matches `rm -rf /`, `rm -rf ~`, `rm -rf /*` and flag-order variants
    // (`rm -fr`, `rm -r -f`), but NOT `rm -rf ./build` or `rm -rf /tmp/x`
    // (a real subdirectory) — the target must be exactly `/`, `~`, or `/*`
    // (optionally with trailing slashes), not a longer path.
    regex: /\brm\s+(-[a-z]*[rf][a-z]*[rf]?[a-z]*|-[rf]\s+-[rf])\s+(\/|~)\/*\*?(?=\s|$)/i,
  },
  {
    id: 'fork-bomb',
    description: 'classic shell fork bomb',
    regex: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  },
  {
    id: 'mkfs-mounted-device',
    description: 'mkfs.* invoked against a device path',
    // mkfs on ANY /dev/* target — we cannot verify mount state from the
    // command text alone, so per the issue's literal wording ("on a
    // currently-mounted device") we block mkfs against a device path
    // outright; formatting an unmounted scratch device should go through an
    // explicit approval path anyway, not straight execution.
    regex: /\bmkfs(\.\w+)?\s+.*\/dev\/\S+/i,
  },
  {
    id: 'dd-zero-to-device',
    description: 'dd if=/dev/zero of=/dev/sd* (or similar block device)',
    regex: /\bdd\s+[^\n]*if=\/dev\/zero[^\n]*of=\/dev\/(sd|hd|nvme|disk)\w*/i,
  },
  {
    id: 'curl-pipe-shell',
    description: 'curl piping a remote URL directly into a shell interpreter',
    regex: /\bcurl\s+[^\n|]*https?:\/\/[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i,
  },
  {
    id: 'wget-pipe-shell',
    description: 'wget piping a remote URL directly into a shell interpreter',
    regex: /\bwget\s+[^\n|]*https?:\/\/[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i,
  },
];

/**
 * True when `command` matches ANY hardline blocklist pattern. This check must
 * run BEFORE mode-based logic (manual/smart/off) — see command_approval.ts —
 * and its result can never be overridden.
 */
export function isHardlineBlocked(command: string): boolean {
  return HARDLINE_BLOCKLIST.some((p) => p.regex.test(command));
}

/** Returns the first matching hardline pattern, or null when none match. */
export function matchHardlineBlock(command: string): BlocklistPattern | null {
  for (const p of HARDLINE_BLOCKLIST) {
    if (p.regex.test(command)) return p;
  }
  return null;
}
