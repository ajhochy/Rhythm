/**
 * #868 — Structured tool-call smoke check for the local oMLX provider.
 *
 * Successful TEXT generation alone is not sufficient evidence that a local
 * model is usable as a coding agent: during manual evaluation,
 * Qwen3-Coder-30B was rejected precisely because it emitted textual
 * `<function=...>` markup in its response content instead of a real
 * OpenAI-compatible structured `tool_calls` entry — a model that "talks about"
 * calling a tool but never actually emits a structured call breaks the agent
 * loop (the harness has nothing to execute) even though the raw HTTP call
 * "succeeds" and produces text.
 *
 * This module provides:
 *   - `hasStructuredToolCall()` — pure assertion logic over an OpenAI
 *     chat-completions-shaped response, unit-testable with a mock/fixture
 *     response (no live server required).
 *   - `runOmlxToolCallSmoke()` — hits a real OpenAI-compatible endpoint (the
 *     oMLX server) with a prompt engineered to require a tool call, and
 *     verifies both (a) a structured tool call was emitted and (b) the loop
 *     can complete by feeding a synthetic tool result back and getting a
 *     final assistant message. This function is meant to be invoked from a
 *     manual verification script (see the trailing comment) — it is NOT run
 *     automatically in CI because it requires a real, running local oMLX
 *     server (Apple Silicon only), which does not exist in this environment.
 */

/** Minimal shape of an OpenAI-compatible chat-completions tool-call entry. */
export interface OpenAiToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

/** Minimal shape of an OpenAI-compatible chat-completions response we care about. */
export interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: OpenAiToolCall[];
    };
    finish_reason?: string;
  }>;
}

export interface ToolCallCheckResult {
  /** True only when a REAL structured tool call was found (not textual markup). */
  hasStructuredToolCall: boolean;
  /** The tool name that was called, when found. */
  toolName?: string;
  /** Parsed arguments object, when the tool call's arguments were valid JSON. */
  toolArguments?: unknown;
  /** Populated when content looks like textual function-call markup instead of a structured call (the Qwen3-Coder-30B failure mode). */
  textualFunctionMarkupDetected: boolean;
  reason: string;
}

/**
 * Regex for the textual `<function=name>{...}</function>` (or similar
 * bracketed) markup some models emit INSTEAD OF a structured tool call. This
 * is exactly the failure mode that got Qwen3-Coder-30B rejected in manual
 * testing — the response "looks like" a tool call to a human reading it, but
 * there is nothing in `message.tool_calls` for the agent harness to execute.
 */
const TEXTUAL_FUNCTION_MARKUP_RE = /<function[=:]|<\|tool_call\|>|```(?:json)?\s*\{\s*"name"\s*:/i;

/**
 * Assert that an OpenAI-compatible chat-completion response contains a REAL
 * structured tool call — not just textual content that resembles one.
 *
 * A response only passes when:
 *   1. `choices[0].message.tool_calls` is a non-empty array, AND
 *   2. the first entry has a non-empty `function.name`.
 *
 * Textual function-call markup in `message.content` (the rejected-model
 * failure mode) is detected and reported via `textualFunctionMarkupDetected`
 * even when it's the ONLY thing present — this makes the failure case
 * diagnosable rather than just "false".
 *
 * Pure function — no network/IO — so it is fully unit-testable against a
 * mock response fixture, satisfying the #868 acceptance criteria that "the
 * assertion logic is unit-testable with a mock OpenAI-style response".
 */
export function hasStructuredToolCall(
  response: OpenAiChatCompletionResponse,
): ToolCallCheckResult {
  const message = response.choices?.[0]?.message;
  const textualFunctionMarkupDetected = Boolean(
    message?.content && TEXTUAL_FUNCTION_MARKUP_RE.test(message.content),
  );

  const toolCalls = message?.tool_calls;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return {
      hasStructuredToolCall: false,
      textualFunctionMarkupDetected,
      reason: textualFunctionMarkupDetected
        ? 'no structured tool_calls entry — model emitted textual function-call markup instead (the Qwen3-Coder-30B failure mode)'
        : 'no structured tool_calls entry in the response',
    };
  }

  const first = toolCalls[0];
  const toolName = first.function?.name;
  if (!toolName) {
    return {
      hasStructuredToolCall: false,
      textualFunctionMarkupDetected,
      reason: 'tool_calls entry present but function.name is missing/empty',
    };
  }

  let toolArguments: unknown;
  try {
    toolArguments = first.function?.arguments ? JSON.parse(first.function.arguments) : {};
  } catch {
    return {
      hasStructuredToolCall: false,
      toolName,
      textualFunctionMarkupDetected,
      reason: `tool_calls entry present (name='${toolName}') but function.arguments is not valid JSON`,
    };
  }

  return {
    hasStructuredToolCall: true,
    toolName,
    toolArguments,
    textualFunctionMarkupDetected,
    reason: `structured tool call '${toolName}' found`,
  };
}

/**
 * True when the model's `finish_reason` indicates the tool-call turn
 * completed in a way the agent loop can act on (`tool_calls`), as opposed to
 * `length` (truncated before the call finished) or `stop` with no tool call
 * (the model just answered in text).
 */
export function toolCallLoopCanProceed(response: OpenAiChatCompletionResponse): boolean {
  const finishReason = response.choices?.[0]?.finish_reason;
  return finishReason === 'tool_calls' && hasStructuredToolCall(response).hasStructuredToolCall;
}

export interface OmlxToolCallSmokeResult {
  ok: boolean;
  firstCallResult: ToolCallCheckResult;
  loopCompleted: boolean;
  reason: string;
}

/**
 * Live smoke check against a real OpenAI-compatible endpoint (the oMLX
 * server). Sends a prompt that can only be satisfactorily answered by calling
 * a `get_current_time` tool, then (if a structured call came back) feeds a
 * synthetic tool result back in a second turn and confirms the model produces
 * a final assistant message — i.e. the FULL tool-call loop completes, not
 * just the first structured call.
 *
 * This function is intentionally NOT wired into the automated vitest suite:
 * it requires a real oMLX server listening on `baseUrl` (Apple Silicon only),
 * which is unavailable in CI/this dev environment. It is exported for use by
 * a manual verification script/runbook once the oMLX app is installed —
 * `node -e "require('./dist/services/local_omlx_tool_call_smoke').runOmlxToolCallSmoke().then(console.log)"`
 * (after `npm run build`) or an ad hoc ts-node/tsx invocation.
 */
export async function runOmlxToolCallSmoke(opts?: {
  baseUrl?: string;
  modelId?: string;
  fetchImpl?: typeof fetch;
}): Promise<OmlxToolCallSmokeResult> {
  const baseUrl = opts?.baseUrl ?? process.env.RHYTHM_LOCAL_OMLX_BASE_URL ?? 'http://127.0.0.1:8000/v1';
  const modelId = opts?.modelId ?? process.env.RHYTHM_LOCAL_OMLX_MODEL_ID ?? 'gpt-oss-20b-MXFP4-Q8';
  const fetchImpl = opts?.fetchImpl ?? fetch;

  const tools = [
    {
      type: 'function',
      function: {
        name: 'get_current_time',
        description: 'Get the current time in a given timezone.',
        parameters: {
          type: 'object',
          properties: { timezone: { type: 'string' } },
          required: ['timezone'],
        },
      },
    },
  ];

  const messages: Array<Record<string, unknown>> = [
    {
      role: 'user',
      content: 'What time is it right now in America/Los_Angeles? Use the get_current_time tool.',
    },
  ];

  const firstResponse = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelId, messages, tools, tool_choice: 'auto' }),
  }).then((r) => r.json() as Promise<OpenAiChatCompletionResponse>);

  const firstCallResult = hasStructuredToolCall(firstResponse);
  if (!firstCallResult.hasStructuredToolCall) {
    return {
      ok: false,
      firstCallResult,
      loopCompleted: false,
      reason: `first turn did not produce a structured tool call: ${firstCallResult.reason}`,
    };
  }

  const assistantMessage = firstResponse.choices?.[0]?.message;
  const toolCallId = assistantMessage?.tool_calls?.[0]?.id ?? 'call_0';

  messages.push(assistantMessage as Record<string, unknown>);
  messages.push({
    role: 'tool',
    tool_call_id: toolCallId,
    content: JSON.stringify({ time: '2026-07-02T09:00:00-07:00' }),
  });

  const secondResponse = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelId, messages, tools, tool_choice: 'auto' }),
  }).then((r) => r.json() as Promise<OpenAiChatCompletionResponse>);

  const finalMessage = secondResponse.choices?.[0]?.message;
  const loopCompleted = Boolean(finalMessage?.content && finalMessage.content.trim().length > 0);

  return {
    ok: loopCompleted,
    firstCallResult,
    loopCompleted,
    reason: loopCompleted
      ? 'tool-call loop completed: structured call emitted and a final assistant message followed the tool result'
      : 'structured tool call was emitted, but the model never produced a final assistant message after the tool result',
  };
}
