/** Lifecycle metadata qualifier only. Never trusts prose or approves/retries work. */
export interface CodingTerminalFact {
  kind: 'coding_terminal_v1'; sdkUserMessageId: string; sdkAssistantMessageId: string;
  sdkSessionId: string; execution: 'completed' | 'failed'; completedAt: number;
  usage: Record<string, unknown> | null;
}

export function qualifyCodingTerminal(input: {
  sdkSessionId: string; anchor: string; messages: Array<{info:Record<string,unknown>;parts?:unknown}>;
  complete: boolean; pending: boolean;
  notBefore?: number;
}): CodingTerminalFact | null {
  if (!input.complete || input.pending || !input.anchor || !input.sdkSessionId) return null;
  const anchor = input.messages.find(m => m.info.id === input.anchor && m.info.role === 'user' && m.info.sessionID === input.sdkSessionId);
  if (!anchor) return null;
  const turns = input.messages.filter(m => m.info.role === 'assistant' && m.info.sessionID === input.sdkSessionId && m.info.parentID === input.anchor);
  const terminal = turns.filter(m => {
    const time = m.info.time as {created?:number;completed?:number}|undefined;
    if (!time || !Number.isFinite(time.created) || !Number.isFinite(time.completed) || time.completed! < time.created!) return false;
    if (input.notBefore !== undefined && time.created! < input.notBefore) return false;
    if (m.info.finish !== 'stop' && m.info.finish !== 'error') return false;
    if (!Array.isArray(m.parts)) return false;
    return !m.parts.some(p => p && typeof p === 'object' && (p as {type?:string}).type === 'tool' &&
      !['completed','error'].includes(String((p as {state?:{status?:string}}).state?.status)));
  });
  if (terminal.length !== 1) return null;
  const info = terminal[0].info;
  if (typeof info.id !== 'string' || !info.id) return null;
  const tokens = info.tokens;
  const usage = tokens && typeof tokens === 'object' && !Array.isArray(tokens) ? tokens as Record<string,unknown> : null;
  const cache = usage?.cache as {read?:number;write?:number}|undefined;
  const validUsage = usage && [usage.input,usage.output,usage.reasoning,cache?.read,cache?.write]
    .every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  return { kind: 'coding_terminal_v1', sdkUserMessageId: input.anchor, sdkAssistantMessageId: String(info.id),
    sdkSessionId: input.sdkSessionId, execution: info.error || info.finish === 'error' ? 'failed' : 'completed',
    completedAt: (info.time as {completed:number}).completed,
    usage: validUsage ? usage : null };
}
