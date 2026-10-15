import { createServer } from 'node:http';
import { createRequire } from 'node:module';
const { scope, identity, labels } = createRequire(import.meta.url)('./grid_transport_guard.cjs');
scope();
const captures = [], guards = {}, guardEvidence = [];
const control = { usage: Object.fromEntries(labels.map((l, i) => [l, { five: i === 1 ? 5 : 40, week: i === 1 ? 10 : 50 }])), fail429: [], unknown: false, malformed: false };
const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
const server = createServer(async (req, res) => {
  try {
    if (req.socket.remoteAddress !== '127.0.0.1') return json(res, 403, { refused: true });
    const url = new URL(req.url, 'http://127.0.0.1:7482');
    if (url.hash || (url.search && !(url.pathname === '/v1/messages' && url.search === '?beta=true'))) return json(res, 400, { refused: true });
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 2_000_000) throw new Error('large'); }
    const body = raw ? JSON.parse(raw) : {};
    if (url.pathname === '/_grid/guard' && req.method === 'POST') {
      if (!['api', 'engine'].includes(body.role) || body.installed !== true) throw new Error('guard');
      if (body.counters) {
        if (Object.keys(body.counters).some(k => !['responses', 'usage', 'decisions', 'loopback', 'refused'].includes(k)) ||
            Object.values(body.counters).some(n => !Number.isSafeInteger(n) || n < 0) ||
            (body.accountLabel !== null && ![...labels, 'classifier'].includes(body.accountLabel))) throw new Error('counters');
        guardEvidence.push({ role: body.role, counters: body.counters, accountLabel: body.accountLabel });
      }
      guards[body.role] = true; return json(res, 200, { accepted: true });
    }
    if (url.pathname === '/_grid/evidence' && req.method === 'GET') return json(res, 200, { guards, captures, guardEvidence });
    if (url.pathname === '/_grid/control' && req.method === 'POST') {
      if (Object.keys(body).some(k => !['usage', 'fail429', 'unknown', 'malformed'].includes(k))) throw new Error('control');
      if (body.usage) for (const [label, values] of Object.entries(body.usage)) {
        if (!labels.includes(label) || !['five', 'week'].every(k => Number.isFinite(values[k]) && values[k] >= 0 && values[k] <= 100)) throw new Error('usage');
        control.usage[label] = values;
      }
      if (body.fail429) { if (!Array.isArray(body.fail429) || body.fail429.some(l => !labels.includes(l))) throw new Error('429'); control.fail429 = body.fail429; }
      for (const k of ['unknown', 'malformed']) if (k in body) { if (typeof body[k] !== 'boolean') throw new Error('control'); control[k] = body[k]; }
      return json(res, 200, { accepted: true }); // append-only captures; no reset/cleanup endpoint
    }
    if (url.pathname === '/v1/decisions' && req.method === 'POST') {
      if (req.headers.authorization !== 'Bearer syntheticgrid-decisions') throw new Error('auth');
      const names = ['tier', 'category', 'can_queue', 'security_sensitive'];
      if (!Array.isArray(body.questions) || body.questions.length !== 4 || body.questions.some((q, i) => q.name !== names[i] || q.type !== ['score', 'choice', 'predicate', 'predicate'][i])) throw new Error('questions');
      const tag = String(body.input).match(/GRID:(tier[1-4]|malformed|security|unknown|nocapacity):([a-f0-9-]+)/);
      if (!tag) throw new Error('synthetic prompt required');
      captures.push({ model: body.model, effort: null, accountLabel: 'classifier', turnTag: tag[2], HTTPstatus: 200 });
      if (control.malformed || tag[1] === 'malformed') return json(res, 200, { answers: [], usage: { input_tokens: 20 } });
      const tier = tag[1].startsWith('tier') ? Number(tag[1].slice(4)) : 4;
      const value = 4 - tier;
      const score = { 4: 0, 3: 0.2, 2: 1, 1: 3 }[tier]; // production thresholds: 0.1 / 0.35 / 2.25
      return json(res, 200, { usage: { input_tokens: 20 }, answers: [
        { name: 'tier', type: 'score', score, confidence: 1, probabilities: ['tier4', 'tier3', 'tier2', 'tier1'].map((label, i) => ({ label, value: i, probability: i === value ? 1 : 0 })) },
        { name: 'category', type: 'choice', choice: 'coding', confidence: 1 },
        { name: 'can_queue', type: 'predicate', probability: 0 },
        { name: 'security_sensitive', type: 'predicate', probability: tag[1] === 'security' ? 1 : 0 },
      ] });
    }
    const accountLabel = identity(new Headers(req.headers));
    if (!accountLabel) throw new Error('account');
    if (url.pathname === '/backend-api/wham/usage' && req.method === 'GET') {
      if (!accountLabel.startsWith('openai-')) throw new Error('provider');
      captures.push({ model: null, effort: null, accountLabel, turnTag: 'usage', HTTPstatus: 200 });
      if (control.unknown) return json(res, 200, {});
      const u = control.usage[accountLabel];
      return json(res, 200, { rate_limit: {
        primary_window: { used_percent: u.five, limit_window_seconds: 18000, reset_after_seconds: 3600 },
        secondary_window: { used_percent: u.week, limit_window_seconds: 604800, reset_after_seconds: 3600 },
      } });
    }
    if (url.pathname === '/v1/messages' && req.method === 'POST') {
      if (!accountLabel.startsWith('anthropic-')) throw new Error('provider');
      const u = control.usage[accountLabel];
      if (body.max_tokens !== 1) {
        const tag = [...JSON.stringify(body.messages).matchAll(/GRID:(?:tier[1-4]|followup|malformed|security|unknown|nocapacity):([a-f0-9-]+)/g)].at(-1)?.[1];
        if (!tag || body.stream !== true || !['claude-sonnet-5-5', 'claude-haiku-5-5'].includes(body.model)) throw new Error('request');
        // Derive effort ONLY from the real wire body, never from the requested route.
        const effort = body.thinking?.type === 'enabled' ? ({ 1024: 'low', 8192: 'medium', 16384: 'high' })[body.thinking.budget_tokens] ?? null : null;
        const status = control.fail429.includes(accountLabel) ? 429 : 200;
        captures.push({ model: body.model, effort, accountLabel, turnTag: tag, HTTPstatus: status });
        if (status === 429) return json(res, 429, { type: 'error', error: { type: 'rate_limit_error', message: 'synthetic quota exhausted' } }, { 'retry-after': '1' });
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        event('message_start', { message: { id: `msg_${tag}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 0 } } });
        event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
        event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: `SYNTHETICGRID_OK ${tag}` } });
        event('content_block_stop', { index: 0 });
        event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } });
        event('message_stop', {});
        return res.end();
      }
      captures.push({ model: body.model, effort: null, accountLabel, turnTag: 'usage', HTTPstatus: 200 });
      return json(res, 200, { content: [{ type: 'text', text: 'synthetic' }] }, control.unknown ? {} : {
        'anthropic-ratelimit-unified-5h-utilization': String(u.five / 100),
        'anthropic-ratelimit-unified-7d-utilization': String(u.week / 100),
      });
    }
    if (url.pathname !== '/backend-api/codex/responses' || req.method !== 'POST' || !accountLabel.startsWith('openai-')) return json(res, 404, { refused: true });
    // Inspect input transiently only. Never store prompt, tools, system text, or headers.
    const tag = [...JSON.stringify(body.input).matchAll(/GRID:(?:tier[1-4]|followup|malformed|security|unknown|nocapacity):([a-f0-9-]+)/g)].at(-1)?.[1];
    if (!tag || !['gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6-astra'].includes(body.model)) throw new Error('request');
    const status = control.fail429.includes(accountLabel) ? 429 : 200;
    captures.push({ model: body.model, effort: body.reasoning?.effort ?? null, accountLabel, turnTag: tag, HTTPstatus: status });
    if (status === 429) return json(res, 429, { error: { type: 'rate_limit_error', message: 'synthetic quota exhausted' } }, { 'retry-after': '1' });
    const text = `SYNTHETICGRID_OK ${tag}`;
    const part = { type: 'output_text', text, annotations: [] };
    const item = { id: `msg_${tag}`, type: 'message', role: 'assistant', status: 'completed', content: [part] };
    const response = { id: `resp_${tag}`, object: 'response', created_at: Math.floor(Date.now() / 1000), model: body.model, status: 'completed', output: [item], usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    let sequence = 0;
    const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...data })}\n\n`);
    event('response.created', { response: { ...response, status: 'in_progress', output: [], usage: null } });
    event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
    event('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { ...part, text: '' } });
    event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: text, logprobs: [] });
    event('response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text, logprobs: [] });
    event('response.content_part.done', { item_id: item.id, output_index: 0, content_index: 0, part });
    event('response.output_item.done', { output_index: 0, item });
    event('response.completed', { response });
    res.end();
  } catch { json(res, 400, { refused: true }); }
});
server.listen(7482, '127.0.0.1');
