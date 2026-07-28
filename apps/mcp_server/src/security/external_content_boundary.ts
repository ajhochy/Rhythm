import { createHash } from "node:crypto";
import { scanContextContent, type InjectionMatch } from "./context_scanner.js";
import type { TrustedSecurityContext } from "./security_context.js";
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
    throw new Error(
      `agent server refused external-content taint (${res.status})`,
    );
  }
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
  await recordExternalContentTaint({
    agentUrl: args.agentUrl,
    context: args.context,
    source: args.source,
    rawContent: args.rawContent,
    blocked: scan.blocked,
    matches: scan.matches,
  });
  if (scan.blocked) {
    return { blocked: true, text: scan.warning as string };
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
    return {
      allowed: false,
      refusalMessage:
        typeof body.error === "string"
          ? `Blocked: ${body.error}`
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
