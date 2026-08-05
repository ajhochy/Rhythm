/**
 * command_approval.ts — Issue #878
 *
 * Command-approval decision engine. Sits at the agent's shell-dispatch
 * boundary (wired into opencode_stream_bridge.ts's `permission.asked` /
 * `permission.updated` handling for the `bash` tool — see that file's #878
 * comment) and decides whether a command may run.
 *
 * Decision order (never reorderable — the hardline blocklist is absolute):
 *   1. Hardline blocklist (command_blocklist.ts) → ALWAYS 'deny'. No mode,
 *      no "always" allowlist entry, and no approval can override this.
 *   2. Persistent "always allow" entry (approval_store.ts) → 'allow'.
 *   3. Mode dispatch:
 *      - 'off'    → 'allow' (must be explicitly configured; see env.ts).
 *      - 'smart'  → local risk classifier (command_risk_classifier.ts):
 *                   low → 'allow', high → 'deny', uncertain → 'ask'.
 *      - 'manual' → always 'ask'.
 *   4. 'ask' results are resolved by `resolveApproval`, which prompts (via
 *      the injected `promptFn`) and applies the configured timeout —
 *      timeout or no response → 'deny' (fail-closed), per the issue.
 */

import { matchHardlineBlock } from './command_blocklist';
import { classifyCommandRisk } from './command_risk_classifier';
import { ApprovalStore } from './approval_store';
import type { ApprovalsMode } from '../config/env';

export type ApprovalDecision = 'allow' | 'deny' | 'ask';

/**
 * Extract the shell command string from a `bash` tool permission's `args`
 * object. The opencode fork's shell tool schema (packages/opencode/src/tool/
 * shell.ts) names the field `command`; `cmd` is accepted defensively in case
 * an older/alternate tool build uses that name. Returns null when no string
 * command is present (the caller should then skip classification entirely
 * rather than guess).
 */
export function extractBashCommand(args: Record<string, unknown> | undefined | null): string | null {
  if (!args) return null;
  const candidate = args.command ?? args.cmd;
  return typeof candidate === 'string' && candidate.trim() !== '' ? candidate : null;
}

/**
 * Every shell command carried by a `bash` permission event.
 *
 * The engine's `permission.asked` payload (`Permission.Request` in
 * apps/opencode_fork/packages/opencode/src/permission/index.ts) has NO `args`
 * and NO `command` field: for the shell tool it passes `metadata: {}` and puts
 * the raw text of each parsed command node in `patterns` (`source(node)` in
 * .../tool/shell.ts). Reading only `args.command` therefore matched nothing for
 * every real engine permission, which silently disabled this entire gate —
 * hardline blocklist included — in the running app, while unit tests that
 * hand-build `args: { command }` stayed green.
 *
 * One event can carry several commands (`a && b`, pipelines, redirections), so
 * this returns all of them and the caller must classify every one — see
 * {@link classifyCommands}.
 */
export function extractBashCommands(
  args: Record<string, unknown> | undefined | null,
  patterns?: readonly unknown[] | null,
): string[] {
  const fromArgs = extractBashCommand(args);
  if (fromArgs) return [fromArgs];
  if (!Array.isArray(patterns)) return [];
  return patterns.filter((p): p is string => typeof p === 'string' && p.trim() !== '');
}

export interface ClassifyResult {
  decision: ApprovalDecision;
  /** Machine-readable reason code, always present so a UI/log can explain the outcome. */
  reason: string;
  /** Human-readable detail (never includes secrets; the command itself is already user-visible). */
  detail: string;
}

/**
 * Classify `command` under `mode`, consulting the persistent "always allow"
 * store. This is the PURE decision step — it does NOT prompt anyone; a
 * result of `decision: 'ask'` means the caller must invoke
 * {@link resolveApproval} (or its own equivalent) to get a final answer.
 */
export function classifyCommand(
  command: string,
  mode: ApprovalsMode,
  approvalStore: ApprovalStore = new ApprovalStore(),
): ClassifyResult {
  // 1. Hardline blocklist — absolute, mode-independent, never overridable.
  const hardline = matchHardlineBlock(command);
  if (hardline) {
    return {
      decision: 'deny',
      reason: `hardline-blocklist:${hardline.id}`,
      detail: `Blocked (cannot be overridden): ${hardline.description}`,
    };
  }

  // 2. Persistent "always allow" — honored regardless of mode (once a user
  //    has explicitly approved a pattern, `off`/`smart`/`manual` all skip it).
  if (approvalStore.isAlwaysAllowed(command)) {
    return {
      decision: 'allow',
      reason: 'always-allowed',
      detail: 'Previously approved with "always" — running without a prompt.',
    };
  }

  // 3. Mode dispatch.
  if (mode === 'off') {
    return {
      decision: 'allow',
      reason: 'mode-off',
      detail: 'approvals.mode=off — no prompts for non-blocklisted commands.',
    };
  }

  if (mode === 'smart') {
    const risk = classifyCommandRisk(command);
    if (risk === 'low') {
      return { decision: 'allow', reason: 'smart-low-risk', detail: 'Classified low-risk — auto-approved.' };
    }
    if (risk === 'high') {
      return { decision: 'deny', reason: 'smart-high-risk', detail: 'Classified high-risk — auto-denied.' };
    }
    return { decision: 'ask', reason: 'smart-uncertain', detail: 'Risk uncertain — escalated to manual approval.' };
  }

  // mode === 'manual' (default): always ask.
  return { decision: 'ask', reason: 'manual-mode', detail: 'approvals.mode=manual — awaiting user approval.' };
}

/**
 * Classify every command and return the most restrictive result
 * (`deny` > `ask` > `allow`), or null when there is nothing to classify. A
 * compound command must not become auto-approvable just because one of its
 * segments is harmless.
 */
export function classifyCommands(
  commands: readonly string[],
  mode: ApprovalsMode,
  approvalStore: ApprovalStore = new ApprovalStore(),
): ClassifyResult | null {
  const rank: Record<ApprovalDecision, number> = { allow: 0, ask: 1, deny: 2 };
  let strongest: ClassifyResult | null = null;
  for (const command of commands) {
    const result = classifyCommand(command, mode, approvalStore);
    if (!strongest || rank[result.decision] > rank[strongest.decision]) strongest = result;
    if (strongest.decision === 'deny') break;
  }
  return strongest;
}

export type ApprovalResponse = 'once' | 'session' | 'always' | 'deny';

export interface ResolveApprovalOptions {
  /** Seconds to wait for a response before failing closed. */
  timeoutSeconds: number;
  /**
   * Prompts the user and resolves with their choice. Must resolve within
   * `timeoutSeconds` on its own if it can (the wrapper below still enforces
   * the timeout independently as a backstop).
   */
  promptFn: (command: string) => Promise<ApprovalResponse>;
  approvalStore?: ApprovalStore;
  /** In-memory per-session allowlist for the "session" response. Caller-owned so it can live for the session's lifetime. */
  sessionAllowlist?: Set<string>;
}

/**
 * Resolve an 'ask' decision by prompting the user, with a fail-closed
 * timeout. Never throws — a prompt rejection is treated the same as a
 * timeout (deny).
 */
export async function resolveApproval(
  command: string,
  opts: ResolveApprovalOptions,
): Promise<{ decision: 'allow' | 'deny'; response: ApprovalResponse | 'timeout' }> {
  const timeoutMs = Math.max(0, opts.timeoutSeconds) * 1000;

  let response: ApprovalResponse | 'timeout';
  try {
    response = await new Promise<ApprovalResponse | 'timeout'>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve('timeout');
        }
      }, timeoutMs);
      // Only set up the timer as unref'd where supported so tests / CLI exit
      // aren't kept alive by a pending timeout.
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as unknown as { unref: () => void }).unref();
      }
      opts
        .promptFn(command)
        .then((r) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(r);
          }
        })
        .catch(() => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve('timeout');
          }
        });
    });
  } catch {
    response = 'timeout';
  }

  if (response === 'timeout' || response === 'deny') {
    return { decision: 'deny', response };
  }

  if (response === 'always') {
    (opts.approvalStore ?? new ApprovalStore()).alwaysAllow(command);
  } else if (response === 'session') {
    opts.sessionAllowlist?.add(command);
  }

  return { decision: 'allow', response };
}
