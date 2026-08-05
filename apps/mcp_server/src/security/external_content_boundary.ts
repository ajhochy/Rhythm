import { createHash } from "node:crypto";
import { scanContextContent, type InjectionMatch } from "./context_scanner.js";
import type { TrustedSecurityContext } from "./security_context.js";
import { currentTrustedSecurityCall } from "./security_context.js";
import { untrustedContext } from "../untrusted_context.js";

export const SECURITY_ACTIONS = [
  "email.send",
  "message.send",
  "message-thread.create",
  "calendar.create",
  "calendar.update",
  "pco.plan-item.update",
  "pco.person.assign",
  "pco.scheduled-person.update",
  "trigger.clear",
  "task.create",
  "task.update",
  "task.complete",
  "task.delete",
  "rhythm.create",
  "rhythm.update",
  "project-instance.create",
  "facility-reservation.create",
  "memory.remember",
  "memory.forget",
  "research.start",
  "research.update",
  "org-optimizer.run",
  "delegation.start",
  "delegation.start-async",
  "notification.send",
  "scheduled-task.create",
  "scheduled-task.cancel",
  "scheduled-task.trigger",
  "memory.update",
  "memory.lifecycle",
  "rhythm.delete",
  "rhythm-step.create",
  "rhythm-step.delete",
  "project-template.create",
  "project-template-step.create",
  "project-step.update",
  "automation.create",
  "automation.update",
  "automation.delete",
  "automation.resync",
  "agent-profile.create",
  "agent-profile.permissions.update",
  "creative-capability.install",
  "creative-artifact.record",
  "org-optimizer.external-discovery",
] as const;

export type SecurityAction = (typeof SECURITY_ACTIONS)[number];

export type ExternalContentSource =
  | "gmail.search"
  | "gmail.message"
  | "message-thread.list"
  | "message-thread.task"
  | "dashboard.message-preview"
  | "calendar.events"
  | "trigger.list"
  | "scheduled-task.list"
  | "task.list"
  | "rhythm.list"
  | "project-template.list"
  | "project-instance.list"
  | "facility.list"
  | "memory.search"
  | "memory.list"
  | "research.job"
  | "automation.list"
  | "automation.get"
  | "automation.preview"
  | "automation-catalog.triggers"
  | "automation-catalog.actions"
  | "automation-catalog.providers"
  | "agent-session.list"
  | "agent-profile.permissions.list"
  | "agent-profile.permissions.get"
  | "feedback.pco-staffing"
  | "feedback.email-sent"
  | "feedback.task-complete"
  | "pco.service-types"
  | "pco.plans"
  | "pco.plan-items"
  | "pco.needed-positions";

interface BoundaryResult {
  allowed: boolean;
  refusalMessage?: string;
}

/**
 * #1302 — sources that are first-party Rhythm-authored data (not content that
 * arrived from outside the system) don't arm the outbound-write approval
 * gate. They are still scanned and still fenced with the same "treat as
 * data, not instructions" directive below — this only skips recording a new
 * taint for THIS read. If the session is already tainted from a genuinely
 * external read earlier in the same turn, that taint is untouched (we simply
 * don't call recordExternalContentTaint here, we don't clear anything).
 *
 * Membership test is "did this content arrive from outside Rhythm?", NOT "is
 * this content sensitive?". Everything below is authored inside Rhythm by the
 * user or by Rhythm's own agents, so reading it is not an ingress of foreign
 * instructions and must not arm the outbound-write gate.
 *
 * #1302 originally admitted only `agent-session.list`, which left the gate
 * armed by Rhythm reading its own database. The practical effect (measured
 * 2026-08-04) was that autonomy was impossible for any job whose input is
 * first-party data: Memory Consolidation reads `memory.list` to do its work,
 * that read armed the gate, and the `memory.remember` that follows then
 * required a human at 02:30. It reported success having captured 0 for days.
 *
 * DO NOT add these — they are genuine ingress points for third-party text and
 * must keep arming the gate: gmail.search, gmail.message, calendar.events,
 * message-thread.list, message-thread.task, dashboard.message-preview,
 * trigger.list, pco.*, feedback.*.
 */
const SOURCES_EXEMPT_FROM_APPROVAL_GATE = new Set<ExternalContentSource>([
  // Rhythm's own agent session transcripts (#1302).
  "agent-session.list",
  // The user's own memory store.
  "memory.list",
  "memory.search",
  // The user's own task / rhythm / project / facility records.
  "task.list",
  "scheduled-task.list",
  "rhythm.list",
  "project-template.list",
  "project-instance.list",
  "facility.list",
  // Rhythm-authored automation config and its static catalog.
  "automation.list",
  "automation.get",
  "automation.preview",
  "automation-catalog.triggers",
  "automation-catalog.actions",
  "automation-catalog.providers",
  // Rhythm's own agent-profile permission records.
  "agent-profile.permissions.list",
  "agent-profile.permissions.get",
]);

/**
 * The agent server answers failures with `{ error: { code, message } }`. Both
 * halves of this boundary used to drop that message on the floor — the taint
 * half never read the body at all, and the consume half tested
 * `typeof body.error === 'string'`, which is never true for an object, so it
 * always fell through to the bare status code. The result was the #1094
 * transcript line "agent server refused external-content taint (403)": a
 * status with no cause, from a server that had already computed the cause.
 *
 * Reasons from that endpoint are fixed, content-free sentences — never
 * external content, arguments, or key material — so they are safe to surface.
 */
function refusalDetail(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const error = (body as { error?: unknown }).error;
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object"
        ? (error as { message?: unknown }).message
        : undefined;
  return typeof message === "string" && message !== "" ? message : "";
}

function sanitizedDiagnostics(matches: InjectionMatch[]) {
  return matches.map(({ patternId, class: patternClass, description }) => ({
    patternId,
    class: patternClass,
    description,
  }));
}

export async function recordExternalContentTaint(args: {
  agentUrl: string;
  context: TrustedSecurityContext;
  source: ExternalContentSource;
  rawContent: string;
  blocked: boolean;
  matches: InjectionMatch[];
}): Promise<void> {
  const res = await fetch(
    `${args.agentUrl}/agent-approvals/external-content/taint`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trustedCall: currentTrustedSecurityCall(),
        context: args.context,
        source: args.source,
        contentDigest: createHash("sha256")
          .update(args.rawContent)
          .digest("hex"),
        blocked: args.blocked,
        diagnostics: sanitizedDiagnostics(args.matches),
      }),
    },
  );
  if (!res.ok) {
    const detail = refusalDetail(await res.json().catch(() => null));
    throw new Error(
      `agent server refused external-content taint for ${args.source} ` +
        `(${res.status})${detail ? `: ${detail}` : ""}`,
    );
  }
}

/**
 * Salvage the clean items out of a flagged LIST-shaped first-party payload.
 *
 * The scanner is all-or-nothing by design: one match withholds the entire
 * payload. For a batch read of the user's own records that is a wildly
 * disproportionate outcome — measured 2026-08-04, exactly 2 of 50 rows in
 * `rhythm_list_memories` mentioned `.env` (pattern `secrets-dotenv`), and all
 * 50 were withheld, so the Memory Consolidation agent could not read the store
 * it exists to consolidate.
 *
 * Dropping the flagged rows and returning the other 48 preserves the safety
 * property that matters — flagged bytes never reach the model — while removing
 * the collateral. It also removes a denial-of-service edge: a single poisoned
 * row can no longer make a whole first-party collection permanently unreadable.
 *
 * Returns null when the payload is not list-shaped or nothing can be salvaged;
 * the caller then keeps the original all-or-nothing behavior.
 *
 * ponytail: handles the two shapes Rhythm's list endpoints actually return —
 * a bare array, or an object with exactly one array-valued key
 * (`{"memories":[...]}`). Anything else falls back rather than guessing.
 */
function salvageCleanListItems(
  rawContent: string,
  label: string,
): { text: string; withheld: number; kept: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return null;
  }

  let items: unknown[];
  let rebuild: (kept: unknown[]) => unknown;

  if (Array.isArray(parsed)) {
    items = parsed;
    rebuild = (kept) => kept;
  } else if (parsed && typeof parsed === 'object') {
    const entries = Object.entries(parsed as Record<string, unknown>);
    const arrayEntries = entries.filter(([, v]) => Array.isArray(v));
    if (arrayEntries.length !== 1) return null;
    const [key, value] = arrayEntries[0]!;
    items = value as unknown[];
    rebuild = (kept) => ({
      ...(parsed as Record<string, unknown>),
      [key]: kept,
    });
  } else {
    return null;
  }

  if (items.length < 2) return null;

  const kept = items.filter(
    (item) => !scanContextContent(JSON.stringify(item, null, 2), label).blocked,
  );
  const withheld = items.length - kept.length;
  if (withheld === 0 || kept.length === 0) return null;

  return {
    text: JSON.stringify(rebuild(kept), null, 2),
    withheld,
    kept: kept.length,
  };
}

/**
 * Single fail-closed ingress for bytes authored outside the current agent
 * turn. The raw value is scanned, its digest/provenance is durably recorded,
 * and only then may scanner-clean content cross an explicit untrusted fence.
 */
export async function scanContextContentAndRecordExternalContentTaint(args: {
  agentUrl: string;
  context: TrustedSecurityContext | null;
  source: ExternalContentSource;
  label: string;
  rawContent: string;
}): Promise<{ blocked: boolean; text: string }> {
  if (!args.context) {
    throw new Error(
      `trusted Rhythm session/turn metadata is unavailable; ${args.label} was not loaded`,
    );
  }
  const scan = scanContextContent(args.rawContent, args.label);
  const isFirstParty = SOURCES_EXEMPT_FROM_APPROVAL_GATE.has(args.source);
  if (!isFirstParty) {
    await recordExternalContentTaint({
      agentUrl: args.agentUrl,
      context: args.context,
      source: args.source,
      rawContent: args.rawContent,
      blocked: scan.blocked,
      matches: scan.matches,
    });
  }
  if (scan.blocked) {
    // Per-item salvage is deliberately limited to first-party collections.
    // For genuine third-party ingress the batch stays all-or-nothing: a
    // multi-item payload from outside can carry an attack split across rows,
    // and the taint record above already asserted `blocked` for the whole
    // payload. Widening this to external sources is a separate decision.
    const salvaged = isFirstParty
      ? salvageCleanListItems(args.rawContent, args.label)
      : null;
    if (!salvaged) {
      return { blocked: true, text: scan.warning as string };
    }
    // The note is server-authored, so it goes OUTSIDE the untrusted fence.
    return {
      blocked: false,
      text:
        `${untrustedContext(salvaged.text, args.label)}\n\n` +
        `[NOTE: ${salvaged.withheld} of ${salvaged.withheld + salvaged.kept} ` +
        `${args.label} item(s) were withheld by the prompt-injection scanner ` +
        `and are not shown. The ${salvaged.kept} shown above are complete and ` +
        `unmodified. Treat this as a partial view of the collection.]`,
    };
  }
  return {
    blocked: false,
    text: untrustedContext(args.rawContent, args.label),
  };
}

export async function authorizeOutboundAction(args: {
  agentUrl: string;
  context: TrustedSecurityContext | null;
  approvalId?: string;
  action: SecurityAction;
  payload: Record<string, unknown>;
}): Promise<BoundaryResult> {
  if (!args.context) {
    return {
      allowed: false,
      refusalMessage:
        "Blocked: trusted Rhythm session/turn metadata is unavailable. Outbound actions fail closed.",
    };
  }

  try {
    const res = await fetch(`${args.agentUrl}/agent-approvals/consume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trustedCall: currentTrustedSecurityCall(),
        context: args.context,
        approvalId: args.approvalId,
        action: args.action,
        payload: args.payload,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (res.ok && body.allowed === true) return { allowed: true };
    const detail = refusalDetail(body);
    return {
      allowed: false,
      refusalMessage: detail
        ? `Blocked: ${detail}`
        : `Blocked: outbound approval authorization failed (${res.status}).`,
    };
  } catch (err) {
    return {
      allowed: false,
      refusalMessage:
        `Blocked: outbound approval authorization failed ` +
        `(${err instanceof Error ? err.message : String(err)}). Failing closed.`,
    };
  }
}
