import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiPost, toolError, toolResult } from "../api_client.js";
import { registerTool } from "./_tool.js";
import { authorizeOutboundAction } from "../security/external_content_boundary.js";
import { trustedSecurityContext } from "../security/security_context.js";

type FetchLike = typeof fetch;

async function postDelegation(
  apiUrl: string,
  apiToken: string,
  body: unknown,
  fetchImpl?: FetchLike,
): Promise<unknown> {
  if (!fetchImpl)
    return apiPost(apiUrl, apiToken, "/agent-delegation/delegate", body);

  const res = await fetchImpl(`${apiUrl}/agent-delegation/delegate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Rhythm API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function postAsyncDelegation(
  apiUrl: string,
  apiToken: string,
  body: unknown,
  fetchImpl?: FetchLike,
): Promise<unknown> {
  if (!fetchImpl)
    return apiPost(apiUrl, apiToken, "/agent-delegation/delegate-async", body);

  const res = await fetchImpl(`${apiUrl}/agent-delegation/delegate-async`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Rhythm API error ${res.status}: ${text}`);
  }
  return res.json();
}

export function registerAgentDelegationTools(
  server: McpServer,
  apiUrl: string,
  apiToken: string,
  fetchImpl?: FetchLike,
) {
  registerTool(
    server,
    "rhythm_delegate",
    "Delegate a focused task from a manager profile to an allowed specialist profile. The target run is re-scoped to the target profile.",
    {
      targetAgentConfigId: z
        .string()
        .describe(
          "The specialist profile id to run. Must be in the manager allowedDelegates list.",
        ),
      prompt: z
        .string()
        .describe("The focused task prompt for the specialist."),
      callerSessionId: z
        .string()
        .optional()
        .describe(
          "Optional. Leave unset — the server resolves the caller session from the " +
            "trusted security context. Only supply this for programmatic callers.",
        ),
      context: z
        .string()
        .optional()
        .describe(
          "Optional manager context to prepend to the delegated prompt.",
        ),
      approval_id: z
        .string()
        .optional()
        .describe(
          "Approval id returned by rhythm_request_approval — required after reading untrusted content.",
        ),
    },
    async (
      { targetAgentConfigId, prompt, callerSessionId, context, approval_id },
      extra,
    ) => {
      const ctx = trustedSecurityContext(extra);
      // `payload` must stay EXACTLY the model-supplied tool arguments: the
      // approval gate compares it against the signed MCP arguments and refuses
      // with "security payload does not match the signed MCP tool arguments" if
      // anything extra is folded in. So the derived caller identity is added to
      // the HTTP body only, AFTER the gate — never to the signed comparison.
      const payload = {
        targetAgentConfigId,
        prompt,
        ...(callerSessionId !== undefined && { callerSessionId }),
        ...(context !== undefined && { context }),
      };
      // #1322 follow-up: the authoritative caller identity. A model cannot know
      // its own Rhythm session id and invents one when asked, so the server
      // resolves the session from this engine session id instead.
      const requestBody = {
        ...payload,
        ...(ctx?.sdkSessionId ? { callerSdkSessionId: ctx.sdkSessionId } : {}),
      };
      const gate = await authorizeOutboundAction({
        agentUrl: apiUrl,
        context: ctx,
        approvalId: typeof approval_id === "string" ? approval_id : undefined,
        action: "delegation.start",
        payload,
      });
      if (!gate.allowed) {
        return {
          content: [
            { type: "text" as const, text: gate.refusalMessage as string },
          ],
          isError: true as const,
        };
      }
      try {
        const result = await postDelegation(
          apiUrl,
          apiToken,
          requestBody,
          fetchImpl,
        );
        return toolResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(
    server,
    "rhythm_delegate_async",
    "Dispatch a focused task from an interactive manager chat to an allowed specialist. Returns immediately; the specialist result is pushed back into the manager session when it finishes. Never use from scheduled, headless, or system runs.",
    {
      targetAgentConfigId: z
        .string()
        .describe(
          "The specialist profile id to run. Must be in the manager allowedDelegates list.",
        ),
      prompt: z
        .string()
        .describe("The focused background task prompt for the specialist."),
      callerSessionId: z
        .string()
        .optional()
        .describe(
          "Optional. Leave unset — the server resolves the caller session from the " +
            "trusted security context. Only supply this for programmatic callers.",
        ),
      context: z
        .string()
        .optional()
        .describe(
          "Optional manager context to prepend to the delegated prompt.",
        ),
      approval_id: z
        .string()
        .optional()
        .describe(
          "Approval id returned by rhythm_request_approval — required after reading untrusted content.",
        ),
    },
    async (
      {
        targetAgentConfigId,
        prompt,
        callerSessionId,
        context,
        approval_id,
      },
      extra,
    ) => {
      const ctx = trustedSecurityContext(extra);
      // `payload` must stay EXACTLY the model-supplied tool arguments: the
      // approval gate compares it against the signed MCP arguments and refuses
      // with "security payload does not match the signed MCP tool arguments" if
      // anything extra is folded in. So the derived caller identity is added to
      // the HTTP body only, AFTER the gate — never to the signed comparison.
      const payload = {
        targetAgentConfigId,
        prompt,
        ...(callerSessionId !== undefined && { callerSessionId }),
        ...(context !== undefined && { context }),
      };
      // #1322 follow-up: the authoritative caller identity. A model cannot know
      // its own Rhythm session id and invents one when asked, so the server
      // resolves the session from this engine session id instead.
      const requestBody = {
        ...payload,
        ...(ctx?.sdkSessionId ? { callerSdkSessionId: ctx.sdkSessionId } : {}),
      };
      const gate = await authorizeOutboundAction({
        agentUrl: apiUrl,
        context: ctx,
        approvalId: typeof approval_id === "string" ? approval_id : undefined,
        action: "delegation.start-async",
        payload,
      });
      if (!gate.allowed) {
        return {
          content: [
            { type: "text" as const, text: gate.refusalMessage as string },
          ],
          isError: true as const,
        };
      }
      try {
        const result = await postAsyncDelegation(
          apiUrl,
          apiToken,
          requestBody,
          fetchImpl,
        );
        return toolResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
