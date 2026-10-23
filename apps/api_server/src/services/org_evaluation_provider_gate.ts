import type { OrgEvaluationRepository } from '../repositories/org_evaluation_repository';
import type { OrgEvaluationStage, OrgEvaluationTokenUsage } from '../models/org_evaluation';
import { createHash } from 'node:crypto';
import { parseObservedDeferredCatalog, type ObservedDeferredCatalog } from './org_evaluation_scope_effects';

export interface EvaluationUpstream {
  url: string;
  headers: Record<string, string>;
  /** Resolver attestation for this exact endpoint/model, never candidate input. */
  protocol: 'openai-responses-v1' | 'codex-oauth-responses-v1' | 'anthropic-messages-v1';
  supportsMaxOutputTokens: true;
  noHiddenContext: true;
}
export interface EvaluationProviderRequest {
  jobId: string;
  stage: OrgEvaluationStage;
  requestKey: string;
  body: Record<string, unknown>;
}
export interface EvaluationProviderResponse {
  status: number;
  contentType: string;
  body: string;
  usage: OrgEvaluationTokenUsage;
  protocol: EvaluationUpstream['protocol'];
  complete: boolean;
  /** Exact sanitized tool catalog that was sent upstream on this request. */
  providerRequestHash: string;
  toolNames: string[];
  deferredCatalog: ObservedDeferredCatalog | null;
}

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_TOKENS = 4096;
const INPUT_OVERHEAD_TOKENS = 1024;
const allowedKeys = new Set(['model', 'input', 'instructions', 'tools', 'tool_choice', 'max_output_tokens', 'store', 'stream']);
const anthropicKeys = new Set(['model', 'messages', 'system', 'tools', 'tool_choice', 'max_tokens', 'stream', 'temperature', 'top_p', 'stop_sequences']);

function boundedAnthropicRequest(body: Record<string, unknown>): { body: Record<string, unknown>; reservedTokens: number; model: string } {
  if (Object.keys(body).some((key) => !anthropicKeys.has(key))) throw new Error('Unsupported hidden state or Anthropic field');
  const model = body.model;
  if (typeof model !== 'string' || !/^[a-zA-Z0-9._/-]{1,100}$/.test(model)) throw new Error('Unsupported evaluation model');
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 32
    || body.messages.some((message) => {
      if (!message || typeof message !== 'object') return true;
      const item = message as Record<string, unknown>;
      if (!['user', 'assistant'].includes(String(item.role)) || Object.keys(item).some((key) => !['role', 'content'].includes(key))) return true;
      if (typeof item.content === 'string') return false;
      if (!Array.isArray(item.content) || item.content.length > 32) return true;
      return item.content.some((content) => {
        if (!content || typeof content !== 'object') return true;
        const part = content as Record<string, unknown>;
        if (part.type === 'text') return typeof part.text !== 'string'
          || Object.keys(part).some((key) => !['type', 'text', 'cache_control'].includes(key))
          || (part.cache_control !== undefined && (!part.cache_control || typeof part.cache_control !== 'object'
            || (part.cache_control as Record<string, unknown>).type !== 'ephemeral'
            || Object.keys(part.cache_control as Record<string, unknown>).join(',') !== 'type'));
        if (part.type === 'tool_use') return typeof part.id !== 'string' || typeof part.name !== 'string'
          || !part.input || typeof part.input !== 'object'
          || Object.keys(part).some((key) => !['type', 'id', 'name', 'input', 'cache_control', 'caller'].includes(key))
          || (part.cache_control !== undefined && (!part.cache_control || typeof part.cache_control !== 'object'
            || (part.cache_control as Record<string, unknown>).type !== 'ephemeral'
            || Object.keys(part.cache_control as Record<string, unknown>).join(',') !== 'type'))
          || (part.caller !== undefined && (!part.caller || typeof part.caller !== 'object'
            || typeof (part.caller as Record<string, unknown>).type !== 'string'
            || String((part.caller as Record<string, unknown>).type).length === 0
            || String((part.caller as Record<string, unknown>).type).length > 32
            || Object.keys(part.caller as Record<string, unknown>).join(',') !== 'type'));
        if (part.type === 'tool_result') return typeof part.tool_use_id !== 'string'
          || typeof part.content !== 'string' || Object.keys(part).some((key) => !['type', 'tool_use_id', 'content', 'is_error', 'cache_control'].includes(key))
          || (part.cache_control !== undefined && (!part.cache_control || typeof part.cache_control !== 'object'
            || (part.cache_control as Record<string, unknown>).type !== 'ephemeral'
            || Object.keys(part.cache_control as Record<string, unknown>).join(',') !== 'type'));
        return true;
      });
    })) throw new Error('Only bounded self-contained Anthropic text and function JSON are supported');
  if (body.system !== undefined && typeof body.system !== 'string'
    && (!Array.isArray(body.system) || body.system.some((part) => !part || typeof part !== 'object'
      || (part as Record<string, unknown>).type !== 'text' || typeof (part as Record<string, unknown>).text !== 'string'
      || Object.keys(part as Record<string, unknown>).some((key) => !['type', 'text', 'cache_control'].includes(key))
      || ((part as Record<string, unknown>).cache_control !== undefined && (
        !(part as Record<string, unknown>).cache_control
        || typeof (part as Record<string, unknown>).cache_control !== 'object'
        || ((part as Record<string, unknown>).cache_control as Record<string, unknown>).type !== 'ephemeral'
        || Object.keys((part as Record<string, unknown>).cache_control as Record<string, unknown>).join(',') !== 'type')))))
    throw new Error('Unsupported Anthropic system content');
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.length > 64
    || body.tools.some((tool) => !tool || typeof tool !== 'object' || typeof (tool as Record<string, unknown>).name !== 'string'
      || !(tool as Record<string, unknown>).input_schema || Object.keys(tool as Record<string, unknown>)
        .some((key) => !['name', 'description', 'input_schema', 'eager_input_streaming'].includes(key))
      || ((tool as Record<string, unknown>).eager_input_streaming !== undefined
        && typeof (tool as Record<string, unknown>).eager_input_streaming !== 'boolean'))))
    throw new Error('Unsupported hosted Anthropic tools');
  if (body.tool_choice !== undefined && (!body.tool_choice || typeof body.tool_choice !== 'object'
    || !['auto', 'none', 'any', 'tool'].includes(String((body.tool_choice as Record<string, unknown>).type))))
    throw new Error('Unsupported Anthropic tool choice');
  if (body.temperature !== undefined && (typeof body.temperature !== 'number' || body.temperature < 0 || body.temperature > 1))
    throw new Error('Unsupported Anthropic temperature');
  if (body.top_p !== undefined && (typeof body.top_p !== 'number' || body.top_p < 0 || body.top_p > 1))
    throw new Error('Unsupported Anthropic top_p');
  if (body.stop_sequences !== undefined && (!Array.isArray(body.stop_sequences) || body.stop_sequences.length > 8
    || body.stop_sequences.some((part) => typeof part !== 'string' || part.length > 100)))
    throw new Error('Unsupported Anthropic stop sequences');
  const requested = body.max_tokens === undefined ? 1024 : body.max_tokens;
  if (!Number.isSafeInteger(requested) || Number(requested) < 1) throw new Error('Invalid output token limit');
  const messages = JSON.parse(JSON.stringify(body.messages)) as Array<Record<string, unknown>>;
  for (const message of messages) {
    if (Array.isArray(message.content)) for (const part of message.content as Array<Record<string, unknown>>) {
      if (part.type === 'tool_use') delete part.caller;
    }
  }
  const systemText = typeof body.system === 'string' ? body.system : Array.isArray(body.system)
    ? body.system.map((part) => String((part as Record<string, unknown>).text)).join('\n\n') : '';
  const firstUser = messages.find((message) => message.role === 'user');
  if (!firstUser) throw new Error('Anthropic request requires a user message');
  const originalFirstText = typeof firstUser.content === 'string' ? firstUser.content :
    (firstUser.content as Array<Record<string, unknown>>).find((part) => part.type === 'text')?.text;
  if (systemText) {
    if (typeof firstUser.content === 'string') firstUser.content = `${systemText}\n\n${firstUser.content}`;
    else (firstUser.content as unknown[]).unshift({ type: 'text', text: systemText });
  }
  const first = String(originalFirstText ?? '');
  const version = '2.1.296';
  const sampled = [4, 7, 20].map((index) => first[index] ?? '0').join('');
  const suffix = createHash('sha256').update(`59cf53e54c78${sampled}${version}`).digest('hex').slice(0, 3);
  const cch = createHash('sha256').update(first).digest('hex').slice(0, 5);
  const billing = `x-anthropic-billing-header: cc_version=${version}.${suffix}; cc_entrypoint=sdk-cli; cch=${cch};`;
  const tools = Array.isArray(body.tools) ? body.tools.map((tool) => {
    const { eager_input_streaming: _hint, ...schema } = tool as Record<string, unknown>;
    return schema;
  }) : undefined;
  const outgoing = { ...body, ...(tools ? { tools } : {}), messages, system: [{ type: 'text', text: billing },
    { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }],
  max_tokens: Math.min(Number(requested), MAX_OUTPUT_TOKENS), stream: true };
  const bytes = Buffer.byteLength(JSON.stringify(outgoing), 'utf8');
  if (bytes > MAX_REQUEST_BYTES) throw new Error('Evaluation request exceeds bounded input');
  return { body: outgoing, reservedTokens: bytes + INPUT_OVERHEAD_TOKENS + Number(outgoing.max_tokens), model };
}

function boundedRequest(body: Record<string, unknown>, codex = false): { body: Record<string, unknown>; reservedTokens: number; model: string } {
  if (Object.keys(body).some((key) => !allowedKeys.has(key)))
    throw new Error('Unsupported hidden state or unbounded provider request field');
  const model = body.model;
  if (typeof model !== 'string' || !/^[a-zA-Z0-9._/-]{1,100}$/.test(model))
    throw new Error('Unsupported evaluation model');
  if (typeof body.input !== 'string' && !Array.isArray(body.input))
    throw new Error('Only bounded self-contained text input is supported');
  if (typeof body.input === 'string' && body.input.length === 0)
    throw new Error('Empty evaluation input');
  if (Array.isArray(body.input)) {
    if (body.input.length === 0 || body.input.length > 16 || body.input.some((item) => {
      if (!item || typeof item !== 'object') return true;
      const entry = item as Record<string, unknown>;
      if (entry.type === 'function_call_output')
        return typeof entry.call_id !== 'string' || typeof entry.output !== 'string'
          || Object.keys(entry).some((key) => !['type', 'call_id', 'output'].includes(key));
      return entry.type !== 'message' || !['user', 'assistant', 'system', 'developer'].includes(String(entry.role))
        || (typeof entry.content !== 'string' && (!Array.isArray(entry.content) || entry.content.length > 32
          || entry.content.some((part: unknown) => !part || typeof part !== 'object'
            || !['input_text', 'output_text'].includes(String((part as Record<string, unknown>).type))
            || typeof (part as Record<string, unknown>).text !== 'string'
            || Object.keys(part as Record<string, unknown>).some((key) => !['type', 'text'].includes(key)))))
        || Object.keys(entry).some((key) => !['type', 'role', 'content'].includes(key));
    })) throw new Error('Unsupported image, remote, or hidden input; bounded text only');
  }
  if (body.instructions !== undefined && typeof body.instructions !== 'string')
    throw new Error('Unsupported instructions');
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools) || body.tools.length > 8 || body.tools.some((tool) => {
      if (!tool || typeof tool !== 'object') return true;
      const spec = tool as Record<string, unknown>;
      return spec.type !== 'function' || typeof spec.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(spec.name)
        || (spec.description !== undefined && typeof spec.description !== 'string')
        || !spec.parameters || typeof spec.parameters !== 'object' || Array.isArray(spec.parameters)
        || (spec.strict !== undefined && typeof spec.strict !== 'boolean')
        || Object.keys(spec).some((key) => !['type', 'name', 'description', 'parameters', 'strict'].includes(key));
    })) throw new Error('Unsupported hosted or unbounded tool; function JSON only');
  }
  if (body.tool_choice !== undefined && body.tool_choice !== 'auto' && body.tool_choice !== 'none')
    throw new Error('Unsupported tool choice');
  if (body.store !== undefined && body.store !== false || body.stream !== undefined && body.stream !== true)
    throw new Error('Unsupported provider persistence or streaming mode');
  const requested = body.max_output_tokens === undefined ? 1024 : body.max_output_tokens;
  if (!Number.isSafeInteger(requested) || Number(requested) < 1)
    throw new Error('Invalid output token limit');
  const maxOutputTokens = Math.min(Number(requested), MAX_OUTPUT_TOKENS);
  const input = codex && typeof body.input === 'string'
    ? [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: body.input }] }] : body.input;
  const outgoing = { ...body, input, ...(codex && body.instructions === undefined
    ? { instructions: 'You are a concise assistant.' } : {}), max_output_tokens: maxOutputTokens, store: false, stream: true };
  const bytes = Buffer.byteLength(JSON.stringify(outgoing), 'utf8');
  if (bytes > MAX_REQUEST_BYTES) throw new Error('Evaluation request exceeds bounded input');
  // UTF-8 bytes dominate visible text/token input for the supported request
  // shape; the fixed allowance covers protocol framing and bounded tool forms.
  // Provider-side hidden context must remain disabled by the resolver.
  return { body: outgoing, reservedTokens: bytes + INPUT_OVERHEAD_TOKENS + maxOutputTokens, model };
}

async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Provider response has no body');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error('Provider response exceeds bounded buffer');
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function terminalUsage(body: string, contentType: string): { usage: OrgEvaluationTokenUsage; complete: boolean } {
  let completion: Record<string, unknown> | null = null;
  let complete = false;
  if (contentType.includes('text/event-stream') || body.startsWith('data:')) {
    for (const block of body.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim()).join('\n');
      if (!data || data === '[DONE]') continue;
      const event = JSON.parse(data) as Record<string, unknown>;
      if (event.type === 'response.completed') { completion = event.response as Record<string, unknown>; complete = true; }
      if (event.type === 'response.failed' || event.type === 'response.incomplete') {
        completion = event.response as Record<string, unknown>; complete = false;
      }
    }
  } else if (contentType.includes('application/json')) {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (['completed', 'incomplete', 'failed'].includes(String(parsed.status))) {
      completion = parsed; complete = parsed.status === 'completed';
    }
  } else throw new Error('Unsupported provider response format');
  const raw = completion?.usage as Record<string, unknown> | undefined;
  const input = raw?.input_tokens;
  const output = raw?.output_tokens;
  const total = raw?.total_tokens;
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || !Number.isSafeInteger(total)
    || Number(input) < 0 || Number(output) < 0 || Number(total) < 1
    || Number(input) + Number(output) !== Number(total)) throw new Error('Terminal provider usage unavailable');
  const cache = (raw?.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens;
  const reasoning = (raw?.output_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens;
  if ((cache !== undefined && (!Number.isSafeInteger(cache) || Number(cache) < 0 || Number(cache) > Number(input)))
    || (reasoning !== undefined && (!Number.isSafeInteger(reasoning) || Number(reasoning) < 0 || Number(reasoning) > Number(output))))
    throw new Error('Invalid terminal provider usage details');
  return { usage: {
    totalTokens: Number(total), inputTokens: Number(input), outputTokens: Number(output),
    cacheReadTokens: Number.isSafeInteger(cache) ? Number(cache) : null,
    reasoningTokens: Number.isSafeInteger(reasoning) ? Number(reasoning) : null,
  }, complete };
}

function anthropicTerminalUsage(body: string, contentType: string): { usage: OrgEvaluationTokenUsage; complete: boolean } {
  let input: Record<string, unknown> | null = null;
  let output: Record<string, unknown> | null = null;
  let stopped = false;
  let maxTokens = false;
  if (!contentType.includes('text/event-stream')) throw new Error('Unsupported Anthropic response format');
  for (const block of body.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim()).join('\n');
    if (!data) continue;
    const event = JSON.parse(data) as Record<string, unknown>;
    if (event.type === 'error') throw new Error('Anthropic stream returned error');
    if (event.type === 'message_start') input = (event.message as Record<string, unknown> | undefined)?.usage as Record<string, unknown> | null;
    if (event.type === 'message_delta') {
      output = event.usage as Record<string, unknown> | null;
      maxTokens = (event.delta as Record<string, unknown> | undefined)?.stop_reason === 'max_tokens';
    }
    if (event.type === 'message_stop') stopped = true;
  }
  const nonNegative = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
  const inputTokens = input?.input_tokens;
  const cacheRead = input?.cache_read_input_tokens ?? 0;
  const cacheWrite = input?.cache_creation_input_tokens ?? 0;
  const outputTokens = output?.output_tokens;
  if (!nonNegative(inputTokens) || !nonNegative(cacheRead) || !nonNegative(cacheWrite) || !nonNegative(outputTokens))
    throw new Error('Terminal Anthropic usage unavailable');
  const allInput = Number(inputTokens) + Number(cacheRead) + Number(cacheWrite);
  const total = allInput + Number(outputTokens);
  if (!Number.isSafeInteger(total) || total < 1) throw new Error('Terminal Anthropic usage unavailable');
  if (!stopped) throw new Error('Terminal Anthropic usage unavailable');
  return { usage: { totalTokens: total, inputTokens: allInput, outputTokens: Number(outputTokens),
    cacheReadTokens: Number(cacheRead), reasoningTokens: null }, complete: !maxTokens };
}

export class OrgEvaluationProviderGate {
  constructor(private readonly deps: {
    repository: OrgEvaluationRepository;
    resolveUpstream: (model: string) => Promise<EvaluationUpstream>;
    fetchImpl?: typeof fetch;
  }) {}

  async request(input: EvaluationProviderRequest): Promise<EvaluationProviderResponse> {
    // Resolve on the trusted server side. The candidate may pick only a model
    // understood by this resolver; URL and credentials never come from body.
    const requestedModel = input.body.model;
    if (typeof requestedModel !== 'string') throw new Error('Unsupported evaluation model');
    const upstream = await this.deps.resolveUpstream(requestedModel);
    const bounded = upstream.protocol === 'anthropic-messages-v1'
      ? boundedAnthropicRequest(input.body) : boundedRequest(input.body, upstream.protocol === 'codex-oauth-responses-v1');
    const parsedUrl = new URL(upstream.url);
    if (upstream.supportsMaxOutputTokens !== true
      || upstream.noHiddenContext !== true || parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password
      || (upstream.protocol === 'anthropic-messages-v1' && (parsedUrl.hostname !== 'api.anthropic.com' || parsedUrl.pathname !== '/v1/messages'))
      || (upstream.protocol === 'codex-oauth-responses-v1' && (parsedUrl.hostname !== 'chatgpt.com' || parsedUrl.pathname !== '/backend-api/codex/responses'))
      || (upstream.protocol === 'openai-responses-v1' && parsedUrl.pathname !== '/v1/responses')
      || !['anthropic-messages-v1', 'codex-oauth-responses-v1', 'openai-responses-v1'].includes(upstream.protocol)
      || parsedUrl.search)
      throw new Error('Unsupported bounded provider endpoint');
    const admission = await this.deps.repository.admitProviderCallAsync({
      jobId: input.jobId, reservationKey: input.requestKey,
      stage: input.stage, maxTokens: bounded.reservedTokens,
    });
    if (!admission.reservation) throw new Error('Whole-run evaluation token budget limit reached');
    if (!admission.created) throw new Error('Evaluation request reservation already used');
    let response: Response;
    let contentType: string;
    let body: string;
    let usage: OrgEvaluationTokenUsage;
    let complete: boolean;
    try {
      response = await (this.deps.fetchImpl ?? fetch)(upstream.url, {
        method: 'POST', headers: { ...upstream.headers, 'content-type': 'application/json' },
        body: JSON.stringify(bounded.body), signal: AbortSignal.timeout(60_000),
      });
      contentType = response.headers.get('content-type') ?? '';
      body = await readBounded(response);
      if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
      const terminal = upstream.protocol === 'anthropic-messages-v1'
        ? anthropicTerminalUsage(body, contentType) : terminalUsage(body, contentType);
      usage = terminal.usage; complete = terminal.complete;
      if (usage.outputTokens! > Number(upstream.protocol === 'anthropic-messages-v1'
        ? bounded.body.max_tokens : bounded.body.max_output_tokens))
        throw new Error('Provider ignored output token ceiling; usage cannot qualify');
    } catch (error) {
      await this.deps.repository.settleTokensAsync({ jobId: input.jobId, reservationKey: input.requestKey, usage: null });
      throw error;
    }
    await this.deps.repository.settleTokensAsync({ jobId: input.jobId, reservationKey: input.requestKey, usage });
    const dispatchTool = Array.isArray(bounded.body.tools)
      ? bounded.body.tools.filter((tool) => (tool as Record<string, unknown>).name === 'mcp_dispatch') : [];
    const deferredCatalog = dispatchTool.length === 1
      ? parseObservedDeferredCatalog((dispatchTool[0] as Record<string, unknown>).description) : null;
    return { status: response.status, contentType, body, usage, protocol: upstream.protocol, complete,
      providerRequestHash: createHash('sha256').update(JSON.stringify(bounded.body)).digest('hex'),
      toolNames: Array.isArray(bounded.body.tools)
        ? bounded.body.tools.map((tool) => String((tool as Record<string, unknown>).name)) : [],
      deferredCatalog };
  }
}
