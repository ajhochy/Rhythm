import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { SQLITE_ORG_EVALUATION_SCHEMA } from '../../database/org_evaluation_schema';
import { OrgEvaluationRepository } from '../../repositories/org_evaluation_repository';
import { OrgEvaluationProviderGate } from '../org_evaluation_provider_gate';

const stores: Database.Database[] = [];
afterEach(() => { for (const db of stores.splice(0)) db.close(); });
async function fixture(maxTokens = 20000, validationReserveTokens = 0) {
  const db = new Database(':memory:'); stores.push(db); db.exec(SQLITE_ORG_EVALUATION_SCHEMA);
  const repository = new OrgEvaluationRepository(db);
  const job = await repository.createJobAsync({ id: 'gate-job', sourceAuditRunId: null,
    ownerUserId: 1, maxTokens, validationReserveTokens, originalHash: 'original',
    targetRef: 'agent_config:owned', targetRevision: '1', inputJson: '{}' });
  return { repository, job };
}
const body = { model: 'gpt-6-luna', input: 'Write a harmless short reply.', max_output_tokens: 2000 };
const completed = () => new Response('data: ' + JSON.stringify({ type: 'response.completed',
  response: { usage: { input_tokens: 21, output_tokens: 9, total_tokens: 30,
    input_tokens_details: { cached_tokens: 4 }, output_tokens_details: { reasoning_tokens: 3 } } } }) + '\n\n',
{ headers: { 'content-type': 'text/event-stream' } });
const resolveUpstream = async () => ({
  url: 'https://example.invalid/v1/responses', headers: { authorization: 'Bearer private-test-value' },
  protocol: 'openai-responses-v1' as const, supportsMaxOutputTokens: true as const, noHiddenContext: true as const,
});

describe('whole-run provider admission', () => {
  it('pins the proven Codex OAuth endpoint to list input and a provider output ceiling', async () => {
    const { repository } = await fixture();
    let sent: Record<string, unknown> = {};
    const gate = new OrgEvaluationProviderGate({ repository,
      resolveUpstream: async () => ({ url: 'https://chatgpt.com/backend-api/codex/responses',
        headers: { authorization: 'Bearer private-test-value' }, protocol: 'codex-oauth-responses-v1',
        supportsMaxOutputTokens: true, noHiddenContext: true }),
      fetchImpl: async (_url, init) => { sent = JSON.parse(String(init?.body)); return completed(); },
    });
    await gate.request({ jobId: 'gate-job', stage: 'generator', requestKey: 'codex-proven',
      body: { model: 'gpt-6.1-sol', input: 'Reply OK.', max_output_tokens: 16 } });
    expect(sent).toMatchObject({ max_output_tokens: 16, store: false, stream: true,
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Reply OK.' }] }] });
    expect(sent.instructions).toBeTruthy();
    expect(JSON.stringify(sent)).not.toContain('private-test-value');
  });
  it('caps Anthropic Messages OAuth requests and accounts for terminal cache and output usage', async () => {
    const { repository } = await fixture();
    let sent: Record<string, unknown> = {};
    const gate = new OrgEvaluationProviderGate({ repository,
      resolveUpstream: async () => ({ url: 'https://api.anthropic.com/v1/messages',
        headers: { authorization: 'Bearer private-test-value', 'anthropic-version': '2023-06-01' },
        protocol: 'anthropic-messages-v1', supportsMaxOutputTokens: true, noHiddenContext: true }),
      fetchImpl: async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return new Response([
          'event: message_start\ndata: ' + JSON.stringify({ type: 'message_start', message: { usage: {
            input_tokens: 12, cache_read_input_tokens: 3, cache_creation_input_tokens: 2, output_tokens: 0 } } }),
          'event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }),
          'event: message_delta\ndata: ' + JSON.stringify({ type: 'message_delta', usage: { output_tokens: 5 } }),
          'event: message_stop\ndata: ' + JSON.stringify({ type: 'message_stop' }),
        ].join('\n\n') + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    const result = await gate.request({ jobId: 'gate-job', stage: 'generator', requestKey: 'anthropic-one',
      body: { model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'Say ok.' }], max_tokens: 90000 } });
    expect(sent).toMatchObject({ max_tokens: 4096, stream: true });
    expect(result.usage).toEqual({ totalTokens: 22, inputTokens: 17, outputTokens: 5,
      cacheReadTokens: 3, reasoningTokens: null });
    expect(await repository.getBudgetAsync('gate-job')).toMatchObject({ settledTokens: 22, outstandingTokens: 0 });
  });
  it('accepts the engine Anthropic text cache marker while rejecting unbounded cache metadata', async () => {
    const { repository } = await fixture();
    const sent: Record<string, unknown>[] = [];
    const gate = new OrgEvaluationProviderGate({ repository,
      resolveUpstream: async () => ({ url: 'https://api.anthropic.com/v1/messages', headers: {},
        protocol: 'anthropic-messages-v1', supportsMaxOutputTokens: true, noHiddenContext: true }),
      fetchImpl: async (_url, init) => { sent.push(JSON.parse(String(init?.body))); return new Response([
        'data: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 10 } } }),
        'data: ' + JSON.stringify({ type: 'message_delta', usage: { output_tokens: 2 } }),
        'data: ' + JSON.stringify({ type: 'message_stop' }),
      ].join('\n\n') + '\n\n', { headers: { 'content-type': 'text/event-stream' } }); },
    });
    const message = { role: 'user', content: [{ type: 'text', text: 'safe prompt', cache_control: { type: 'ephemeral' } }] };
    await gate.request({ jobId: 'gate-job', stage: 'generator', requestKey: 'cache-safe',
      body: { model: 'claude-sonnet-4-5', messages: [message], max_tokens: 16 } });
    expect(sent).toHaveLength(1);
    expect(sent[0].messages).toMatchObject([message]);
    await expect(gate.request({ jobId: 'gate-job', stage: 'generator', requestKey: 'cache-bad',
      body: { model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: [{ type: 'text', text: 'x',
        cache_control: { type: 'persistent' } }] }], max_tokens: 16 } }))
      .rejects.toThrow(/bounded self-contained/);
    expect(sent).toHaveLength(1);
  });
  it('accepts the engine local function schema while stripping its streaming hint', async () => {
    const { repository } = await fixture();
    let sent: Record<string, unknown> = {};
    const gate = new OrgEvaluationProviderGate({ repository,
      resolveUpstream: async () => ({ url: 'https://api.anthropic.com/v1/messages', headers: {},
        protocol: 'anthropic-messages-v1', supportsMaxOutputTokens: true, noHiddenContext: true }),
      fetchImpl: async (_url, init) => { sent = JSON.parse(String(init?.body)); return new Response([
        'data: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 10 } } }),
        'data: ' + JSON.stringify({ type: 'message_delta', usage: { output_tokens: 2 } }),
        'data: ' + JSON.stringify({ type: 'message_stop' }),
      ].join('\n\n') + '\n\n', { headers: { 'content-type': 'text/event-stream' } }); },
    });
    const result = await gate.request({ jobId: 'gate-job', stage: 'original-probe', requestKey: 'engine-shape', body: {
      model: 'claude-sonnet-4-5', max_tokens: 16, stream: true,
      system: [{ type: 'text', text: 'System', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Prompt', cache_control: { type: 'ephemeral' } }] }],
      tools: [{ name: 'read_fixture', description: 'Read local fixture',
        input_schema: { type: 'object', properties: {} }, eager_input_streaming: true }],
      tool_choice: { type: 'auto' },
    } });
    expect(sent.tools).toEqual([{ name: 'read_fixture', description: 'Read local fixture',
      input_schema: { type: 'object', properties: {} } }]);
    expect(result.deferredCatalog).toBeNull();
    expect(JSON.stringify(sent)).not.toContain('eager_input_streaming');
  });
  it('accepts bounded Anthropic tool history and strips caller metadata before forwarding', async () => {
    const { repository } = await fixture();
    let sent: Record<string, unknown> = {};
    const gate = new OrgEvaluationProviderGate({ repository,
      resolveUpstream: async () => ({ url: 'https://api.anthropic.com/v1/messages', headers: {},
        protocol: 'anthropic-messages-v1', supportsMaxOutputTokens: true, noHiddenContext: true }),
      fetchImpl: async (_url, init) => { sent = JSON.parse(String(init?.body)); return new Response([
        'data: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 22 } } }),
        'data: ' + JSON.stringify({ type: 'message_delta', usage: { output_tokens: 3 } }),
        'data: ' + JSON.stringify({ type: 'message_stop' }),
      ].join('\n\n') + '\n\n', { headers: { 'content-type': 'text/event-stream' } }); },
    });
    const messages = [{ role: 'assistant', content: [{ type: 'text', text: 'Reading local fixture.' },
      { type: 'tool_use', id: 'call-1', name: 'read_fixture', input: { key: 'request' },
        caller: { type: 'direct' }, cache_control: { type: 'ephemeral' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'safe result',
      cache_control: { type: 'ephemeral' } }] }];
    await gate.request({ jobId: 'gate-job', stage: 'candidate-probe', requestKey: 'tool-history',
      body: { model: 'claude-sonnet-4-5', messages, max_tokens: 16 } });
    expect(JSON.stringify(sent)).not.toContain('caller');
    expect(sent.messages).toMatchObject([{ content: [{ type: 'text' }, { type: 'tool_use',
      cache_control: { type: 'ephemeral' } }] }, { content: [{ type: 'tool_result' }] }]);
    await expect(gate.request({ jobId: 'gate-job', stage: 'candidate-probe', requestKey: 'hidden-caller',
      body: { model: 'claude-sonnet-4-5', messages: [{ role: 'assistant', content: [{ type: 'tool_use',
        id: 'call-2', name: 'read_fixture', input: {}, caller: { type: 'direct', previous_response_id: 'secret' } }] },
      { role: 'user', content: 'Continue.' }], max_tokens: 16 } }))
      .rejects.toThrow(/bounded self-contained/);
  });
  it('settles known usage from output-limited responses but does not mark them complete', async () => {
    const { repository } = await fixture();
    const gate = new OrgEvaluationProviderGate({ repository, resolveUpstream,
      fetchImpl: async () => new Response('data: ' + JSON.stringify({ type: 'response.incomplete',
        response: { usage: { input_tokens: 20, output_tokens: 16, total_tokens: 36 } } }) + '\n\n',
      { headers: { 'content-type': 'text/event-stream' } }),
    });
    const response = await gate.request({ jobId: 'gate-job', stage: 'generator', requestKey: 'capped',
      body: { ...body, max_output_tokens: 16 } });
    expect(response.complete).toBe(false);
    expect(await repository.getBudgetAsync('gate-job')).toMatchObject({ settledTokens: 36, outstandingTokens: 0, hasUnknownUsage: false });
  });
  it('settles Anthropic max_tokens usage while refusing a complete result', async () => {
    const { repository } = await fixture();
    const gate = new OrgEvaluationProviderGate({ repository,
      resolveUpstream: async () => ({ url: 'https://api.anthropic.com/v1/messages', headers: {},
        protocol: 'anthropic-messages-v1', supportsMaxOutputTokens: true, noHiddenContext: true }),
      fetchImpl: async () => new Response([
        'data: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 12 } } }),
        'data: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 16 } }),
        'data: ' + JSON.stringify({ type: 'message_stop' }),
      ].join('\n\n') + '\n\n', { headers: { 'content-type': 'text/event-stream' } }),
    });
    const response = await gate.request({ jobId: 'gate-job', stage: 'generator', requestKey: 'anthropic-capped',
      body: { model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'A long answer.' }], max_tokens: 16 } });
    expect(response.complete).toBe(false);
    expect(await repository.getBudgetAsync('gate-job')).toMatchObject({ settledTokens: 28, outstandingTokens: 0, hasUnknownUsage: false });
  });
  it('settles provider usage once without double-counting cached or reasoning tokens', async () => {
    const { repository } = await fixture();
    const gate = new OrgEvaluationProviderGate({ repository, resolveUpstream, fetchImpl: async () => completed() });
    const result = await gate.request({ jobId: 'gate-job', stage: 'generator', requestKey: 'call-1', body });
    expect(result.status).toBe(200);
    expect(result.usage).toEqual({ totalTokens: 30, inputTokens: 21, outputTokens: 9, cacheReadTokens: 4, reasoningTokens: 3 });
    expect(await repository.getBudgetAsync('gate-job')).toMatchObject({ settledTokens: 30, outstandingTokens: 0, hasUnknownUsage: false });
    await expect(gate.request({ jobId: 'gate-job', stage: 'generator', requestKey: 'call-1', body })).rejects.toThrow(/already|repeat|reservation/i);
    expect((await repository.getBudgetAsync('gate-job')).settledTokens).toBe(30);
  });

  it('refuses a request before contacting a provider when validation capacity would be spent', async () => {
    const { repository } = await fixture(4000, 3000);
    let contacted = false;
    const gate = new OrgEvaluationProviderGate({ repository, resolveUpstream,
      fetchImpl: async () => { contacted = true; return completed(); } });
    await expect(gate.request({ jobId: 'gate-job', stage: 'candidate-probe', requestKey: 'too-large', body })).rejects.toThrow(/budget|limit/i);
    expect(contacted).toBe(false);
    expect(await repository.getBudgetAsync('gate-job')).toMatchObject({ settledTokens: 0, outstandingTokens: 0, totalAvailableTokens: 4000 });
  });

  it('puts an unknown-usage response on hold instead of refunding its reservation', async () => {
    const { repository } = await fixture();
    const gate = new OrgEvaluationProviderGate({ repository, resolveUpstream,
      fetchImpl: async () => new Response('data: {"type":"response.completed","response":{}}\n\n') });
    await expect(gate.request({ jobId: 'gate-job', stage: 'judge', requestKey: 'unknown', body })).rejects.toThrow(/usage/i);
    expect(await repository.getBudgetAsync('gate-job')).toMatchObject({ hasUnknownUsage: true, settledTokens: 0 });
    expect((await repository.getBudgetAsync('gate-job')).outstandingTokens).toBeGreaterThan(0);
    expect(await repository.getJobAsync('gate-job')).toMatchObject({ status: 'inconclusive' });
  });

  it('sends an enforced output ceiling and no credentials supplied by a candidate', async () => {
    const { repository } = await fixture();
    let forwarded: Record<string, unknown> = {};
    const gate = new OrgEvaluationProviderGate({ repository, resolveUpstream,
      fetchImpl: async (_url, init) => { forwarded = JSON.parse(String(init?.body)); return completed(); } });
    await gate.request({ jobId: 'gate-job', stage: 'original-probe', requestKey: 'bounded',
      body: { ...body, max_output_tokens: 90000 } });
    expect(forwarded).toMatchObject({ max_output_tokens: 4096, store: false, stream: true });
    expect(JSON.stringify(forwarded)).not.toContain('private-test-value');
  });

  it('refuses provider-side hidden state, images and hosted tools outside bounded text requests', async () => {
    const { repository } = await fixture();
    let contacted = false;
    const gate = new OrgEvaluationProviderGate({ repository, resolveUpstream,
      fetchImpl: async () => { contacted = true; return completed(); } });
    for (const extra of [ { previous_response_id: 'hidden' }, { tools: [{ type: 'web_search' }] },
      { input: [{ type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'https://example.invalid/a.png' }] }] } ]) {
      await expect(gate.request({ jobId: 'gate-job', stage: 'candidate-probe', requestKey: JSON.stringify(extra), body: { ...body, ...extra } })).rejects.toThrow(/bounded|unsupported|hidden/i);
    }
    expect(contacted).toBe(false);
  });

  it('admits a repeated request key exactly once even when callers race', async () => {
    const { repository } = await fixture();
    let calls = 0;
    const gate = new OrgEvaluationProviderGate({ repository, resolveUpstream,
      fetchImpl: async () => { calls++; return completed(); } });
    const outcomes = await Promise.allSettled([
      gate.request({ jobId: 'gate-job', stage: 'generator', requestKey: 'same-key', body }),
      gate.request({ jobId: 'gate-job', stage: 'generator', requestKey: 'same-key', body }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(calls).toBe(1);
    expect((await repository.getBudgetAsync('gate-job')).settledTokens).toBe(30);
  });

  it('does not overspend when distinct children race for the last budget', async () => {
    const { repository } = await fixture(7000, 1000);
    let calls = 0;
    const gate = new OrgEvaluationProviderGate({ repository, resolveUpstream,
      fetchImpl: async () => { calls++; return completed(); } });
    const large = { ...body, max_output_tokens: 4096 };
    const outcomes = await Promise.allSettled([
      gate.request({ jobId: 'gate-job', stage: 'candidate-probe', requestKey: 'child-a', body: large }),
      gate.request({ jobId: 'gate-job', stage: 'candidate-probe', requestKey: 'child-b', body: large }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(calls).toBe(1);
    expect((await repository.getBudgetAsync('gate-job')).settledTokens).toBe(30);
  });

  it('holds budget and stops the job when transport aborts after admission', async () => {
    const { repository } = await fixture();
    const gate = new OrgEvaluationProviderGate({ repository, resolveUpstream,
      fetchImpl: async () => { throw new Error('connection reset'); } });
    await expect(gate.request({ jobId: 'gate-job', stage: 'generator', requestKey: 'aborted', body }))
      .rejects.toThrow('connection reset');
    expect(await repository.getBudgetAsync('gate-job')).toMatchObject({ hasUnknownUsage: true });
    expect((await repository.getBudgetAsync('gate-job')).outstandingTokens).toBeGreaterThan(0);
    expect(await repository.getJobAsync('gate-job')).toMatchObject({ status: 'inconclusive' });
  });

  it('fails closed when a provider ignores the enforced output ceiling', async () => {
    const { repository } = await fixture();
    const gate = new OrgEvaluationProviderGate({ repository, resolveUpstream,
      fetchImpl: async () => new Response('data: ' + JSON.stringify({ type: 'response.completed',
        response: { usage: { input_tokens: 20, output_tokens: 5000, total_tokens: 5020 } } }) + '\n\n',
      { headers: { 'content-type': 'text/event-stream' } }),
    });
    await expect(gate.request({ jobId: 'gate-job', stage: 'candidate-probe', requestKey: 'ignored-cap',
      body: { ...body, max_output_tokens: 90000 } })).rejects.toThrow(/ceiling/i);
    expect(await repository.getJobAsync('gate-job')).toMatchObject({ status: 'inconclusive' });
    expect(await repository.getBudgetAsync('gate-job')).toMatchObject({ hasUnknownUsage: true });
  });

  it('refuses an endpoint that cannot attest to output limits and hidden-context isolation', async () => {
    const { repository } = await fixture();
    let calls = 0;
    const gate = new OrgEvaluationProviderGate({ repository,
      resolveUpstream: async () => ({ ...(await resolveUpstream()), supportsMaxOutputTokens: false as never }),
      fetchImpl: async () => { calls++; return completed(); },
    });
    await expect(gate.request({ jobId: 'gate-job', stage: 'generator', requestKey: 'unsupported', body }))
      .rejects.toThrow(/unsupported/i);
    expect(calls).toBe(0);
    expect((await repository.getBudgetAsync('gate-job')).outstandingTokens).toBe(0);
  });
});
