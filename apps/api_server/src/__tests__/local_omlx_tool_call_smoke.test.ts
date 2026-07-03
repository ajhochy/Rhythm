import { describe, expect, it, vi } from 'vitest';
import {
  hasStructuredToolCall,
  toolCallLoopCanProceed,
  runOmlxToolCallSmoke,
  type OpenAiChatCompletionResponse,
} from '../services/local_omlx_tool_call_smoke';

/**
 * #868 acceptance criteria: "successful text generation alone is
 * insufficient — Qwen3-Coder-30B was rejected precisely because it emitted
 * textual `<function=...>` markup instead of structured tool calls." These
 * tests assert the checker distinguishes a REAL structured tool call from
 * that failure mode using mock OpenAI-style responses (no live server).
 */
describe('hasStructuredToolCall (#868 structured tool-call smoke)', () => {
  it('passes for a real structured tool call', () => {
    const response: OpenAiChatCompletionResponse = {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'get_current_time', arguments: '{"timezone":"America/Los_Angeles"}' },
              },
            ],
          },
        },
      ],
    };
    const result = hasStructuredToolCall(response);
    expect(result.hasStructuredToolCall).toBe(true);
    expect(result.toolName).toBe('get_current_time');
    expect(result.toolArguments).toEqual({ timezone: 'America/Los_Angeles' });
    expect(result.textualFunctionMarkupDetected).toBe(false);
  });

  it('FAILS for the Qwen3-Coder-30B textual-markup failure mode (plain text pretending to be a call)', () => {
    const response: OpenAiChatCompletionResponse = {
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: '<function=get_current_time>{"timezone": "America/Los_Angeles"}</function>',
          },
        },
      ],
    };
    const result = hasStructuredToolCall(response);
    expect(result.hasStructuredToolCall).toBe(false);
    expect(result.textualFunctionMarkupDetected).toBe(true);
    expect(result.reason).toMatch(/textual function-call markup/);
  });

  it('fails when tool_calls is absent and content is plain text (no tool use at all)', () => {
    const response: OpenAiChatCompletionResponse = {
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'It is 9am.' } }],
    };
    const result = hasStructuredToolCall(response);
    expect(result.hasStructuredToolCall).toBe(false);
    expect(result.textualFunctionMarkupDetected).toBe(false);
  });

  it('fails when tool_calls is present but empty', () => {
    const response: OpenAiChatCompletionResponse = {
      choices: [{ message: { role: 'assistant', content: null, tool_calls: [] } }],
    };
    expect(hasStructuredToolCall(response).hasStructuredToolCall).toBe(false);
  });

  it('fails when the tool call has no function name', () => {
    const response: OpenAiChatCompletionResponse = {
      choices: [{ message: { role: 'assistant', tool_calls: [{ function: { arguments: '{}' } }] } }],
    };
    const result = hasStructuredToolCall(response);
    expect(result.hasStructuredToolCall).toBe(false);
    expect(result.reason).toMatch(/function\.name is missing/);
  });

  it('fails when the tool call arguments are not valid JSON', () => {
    const response: OpenAiChatCompletionResponse = {
      choices: [
        { message: { role: 'assistant', tool_calls: [{ function: { name: 'foo', arguments: '{not json' } }] } },
      ],
    };
    const result = hasStructuredToolCall(response);
    expect(result.hasStructuredToolCall).toBe(false);
    expect(result.reason).toMatch(/not valid JSON/);
  });

  it('handles a missing/empty response shape without throwing', () => {
    expect(hasStructuredToolCall({}).hasStructuredToolCall).toBe(false);
    expect(hasStructuredToolCall({ choices: [] }).hasStructuredToolCall).toBe(false);
  });
});

describe('toolCallLoopCanProceed', () => {
  it('true only when finish_reason is tool_calls AND a structured call is present', () => {
    const good: OpenAiChatCompletionResponse = {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: { tool_calls: [{ function: { name: 'x', arguments: '{}' } }] },
        },
      ],
    };
    expect(toolCallLoopCanProceed(good)).toBe(true);
  });

  it('false when finish_reason says tool_calls but none are structurally present (inconsistent/malformed response)', () => {
    const inconsistent: OpenAiChatCompletionResponse = {
      choices: [{ finish_reason: 'tool_calls', message: { content: 'oops', tool_calls: [] } }],
    };
    expect(toolCallLoopCanProceed(inconsistent)).toBe(false);
  });

  it('false when the model just answered in text (finish_reason stop)', () => {
    const textOnly: OpenAiChatCompletionResponse = {
      choices: [{ finish_reason: 'stop', message: { content: 'It is 9am.' } }],
    };
    expect(toolCallLoopCanProceed(textOnly)).toBe(false);
  });
});

/**
 * `runOmlxToolCallSmoke` requires a real local oMLX server — not available in
 * this environment/CI. This test exercises its full two-turn loop logic with
 * a mocked `fetch`, proving the wiring (tool_call_id threading, message
 * history, final-message detection) is correct without a live server. See
 * the module's trailing doc comment for how to run it for real once oMLX is
 * installed.
 */
describe('runOmlxToolCallSmoke (mocked fetch — no live server required)', () => {
  it('reports ok=true when a structured call is followed by a final assistant message', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                tool_calls: [
                  { id: 'call_1', function: { name: 'get_current_time', arguments: '{"timezone":"America/Los_Angeles"}' } },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'It is 9:00 AM.' } }],
        }),
      });

    const result = await runOmlxToolCallSmoke({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.ok).toBe(true);
    expect(result.loopCompleted).toBe(true);
    expect(result.firstCallResult.hasStructuredToolCall).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reports ok=false when the first turn never produces a structured call', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      json: async () => ({
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '<function=get_current_time>{}</function>' } }],
      }),
    });

    const result = await runOmlxToolCallSmoke({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.ok).toBe(false);
    expect(result.loopCompleted).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports ok=false when the loop never produces a final message after the tool result', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: { role: 'assistant', tool_calls: [{ id: 'call_1', function: { name: 'x', arguments: '{}' } }] },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '' } }] }),
      });

    const result = await runOmlxToolCallSmoke({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.ok).toBe(false);
    expect(result.loopCompleted).toBe(false);
  });
});
