import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolError, toolResult } from "../api_client.js";
import {
  authorizeOutboundAction,
  scanContextContentAndRecordExternalContentTaint,
  type ExternalContentSource,
} from "../security/external_content_boundary.js";
import { trustedSecurityContext } from "../security/security_context.js";
import { registerTool } from "./_tool.js";

const bundle = z.object({ html: z.string(), css: z.string(), js: z.string() });
const capability = z.literal("pco.services.read");
type Json = Record<string, unknown>;

async function request(apiUrl: string, apiToken: string, path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiToken}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
  });
  const body = await response.json().catch(() => ({}));
  // Preserve API failures (including 404, 409 conflict revisions, and 410 tombstones) as failed tool results.
  if (!response.ok) throw new Error(`Rhythm API error ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

export function registerLiveArtifactTools(
  server: McpServer,
  apiUrl = process.env.RHYTHM_API_URL ?? "https://api.vcrcapps.com",
  apiToken: string,
  agentUrl = process.env.RHYTHM_AGENT_URL ?? "http://127.0.0.1:4001",
): void {
  const externalResult = async (data: unknown, source: ExternalContentSource, label: string, extra: Parameters<typeof trustedSecurityContext>[0]) => {
    const ingress = await scanContextContentAndRecordExternalContentTaint({
      agentUrl, context: trustedSecurityContext(extra), source, label, rawContent: JSON.stringify(data, null, 2),
    });
    return ingress.blocked
      ? { content: [{ type: "text" as const, text: ingress.text }], isError: true as const }
      : toolResult(ingress.text);
  };
  registerTool(server, "rhythm_list_live_artifacts", "List visible HTML live artifacts, optionally searching titles.", {
    search: z.string().optional(),
  }, async ({ search }: { search?: string }, extra) => {
    try {
      const query = new URLSearchParams({ type: "html" });
      if (search) query.set("search", search);
      return await externalResult(await request(apiUrl, apiToken, `/live-artifacts?${query}`), "live-artifact.list", "live artifacts", extra);
    } catch (error) { return toolError(error); }
  });

  registerTool(server, "rhythm_get_live_artifact", "Get visible live-artifact metadata and current JSON state by stable ID.", {
    id: z.string(),
  }, async ({ id }: { id: string }, extra) => {
    try {
      return await externalResult(await request(apiUrl, apiToken, `/live-artifacts/${encodeURIComponent(id)}`), "live-artifact.get", "live artifact", extra);
    } catch (error) { return toolError(error); }
  });

  registerTool(server, "rhythm_create_live_artifact", "Create one HTML live artifact with its initial bundle and JSON state.", {
    title: z.string(), workspace_id: z.number().int(), bundle, state: z.record(z.unknown()),
    visibility: z.enum(["private", "shared", "organization"]).optional(),
    collaborators: z.array(z.number().int()).optional(), declared_capabilities: z.array(capability).optional(),
    approval_id: z.string().optional(),
  }, async ({ title, workspace_id, bundle: artifactBundle, state, visibility, collaborators, declared_capabilities, approval_id }: {
    title: string; workspace_id: number; bundle: z.infer<typeof bundle>; state: Json; visibility?: "private" | "shared" | "organization"; collaborators?: number[]; declared_capabilities?: Array<"pco.services.read">; approval_id?: string;
  }, extra) => {
    const payload = { type: "html", title, workspaceId: workspace_id, bundle: artifactBundle, state, ...(visibility && { visibility }), ...(collaborators && { collaborators }), ...(declared_capabilities && { declaredCapabilities: declared_capabilities }) };
    const gate = await authorizeOutboundAction({ agentUrl, context: trustedSecurityContext(extra), approvalId: approval_id, action: "live-artifact.create", payload });
    if (!gate.allowed) return { content: [{ type: "text" as const, text: gate.refusalMessage as string }], isError: true as const };
    try { return toolResult(JSON.stringify(await request(apiUrl, apiToken, "/live-artifacts", { method: "POST", body: JSON.stringify(payload) }), null, 2)); }
    catch (error) { return toolError(error); }
  });

  registerTool(server, "rhythm_update_live_artifact_state", "Revision-check and replace an artifact's JSON state.", {
    id: z.string(), state: z.record(z.unknown()), expected_state_revision: z.number().int().positive(), approval_id: z.string().optional(),
  }, async ({ id, state, expected_state_revision, approval_id }: { id: string; state: Json; expected_state_revision: number; approval_id?: string }, extra) => {
    const payload = { id, state, expectedStateRevision: expected_state_revision };
    const gate = await authorizeOutboundAction({ agentUrl, context: trustedSecurityContext(extra), approvalId: approval_id, action: "live-artifact.state.update", payload });
    if (!gate.allowed) return { content: [{ type: "text" as const, text: gate.refusalMessage as string }], isError: true as const };
    try { return toolResult(JSON.stringify(await request(apiUrl, apiToken, `/live-artifacts/${encodeURIComponent(id)}/state`, { method: "PUT", body: JSON.stringify({ expectedStateRevision: expected_state_revision, state }) }), null, 2)); }
    catch (error) { return toolError(error); }
  });

  registerTool(server, "rhythm_update_live_artifact_bundle", "Revision-check and replace an artifact's HTML, CSS, and JavaScript bundle.", {
    id: z.string(), bundle, expected_bundle_revision: z.number().int().positive(), approval_id: z.string().optional(),
  }, async ({ id, bundle: artifactBundle, expected_bundle_revision, approval_id }: { id: string; bundle: z.infer<typeof bundle>; expected_bundle_revision: number; approval_id?: string }, extra) => {
    const payload = { id, bundle: artifactBundle, expectedBundleRevision: expected_bundle_revision };
    const gate = await authorizeOutboundAction({ agentUrl, context: trustedSecurityContext(extra), approvalId: approval_id, action: "live-artifact.bundle.update", payload });
    if (!gate.allowed) return { content: [{ type: "text" as const, text: gate.refusalMessage as string }], isError: true as const };
    try { return toolResult(JSON.stringify(await request(apiUrl, apiToken, `/live-artifacts/${encodeURIComponent(id)}/bundle`, { method: "PUT", body: JSON.stringify({ expectedBundleRevision: expected_bundle_revision, bundle: artifactBundle }) }), null, 2)); }
    catch (error) { return toolError(error); }
  });
}
