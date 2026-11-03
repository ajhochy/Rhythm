import {
  getDecisionFeatureMode,
  getDecisionToolEagerServers,
  getDecisionToolMinScore,
} from '../../config/env';
import type { McpAllowlist } from '../mcp_allowlist_expander';
import { rankCandidates } from './decision_engine';
import type { DecisionOpts } from './decision_engine';
import { recordDecision } from './decision_log';

const MAX_TOOLS_IN_TEXT = 40;
const sanitize = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, '_');

export interface RankMcpAllowlistOpts {
  /** Raw server name -> tool count (from toolCountsForRoleConfig); names known servers. */
  toolCounts?: Record<string, number>;
  /** Cached live catalog of `server_tool` ids; only used to enrich candidate text. */
  catalogToolIds?: string[];
  sessionId?: string;
  client?: DecisionOpts['client'];
}

/** Map every granted tool id to its owning server (longest known-prefix match). */
function ownerOf(toolId: string, known: string[]): string {
  let best: string | null = null;
  for (const s of known) {
    if (toolId.startsWith(`${s}_`) && (best === null || s.length > best.length)) best = s;
  }
  return best ?? toolId.split('_')[0];
}

/**
 * Reorder an MCP allowlist by relevance to the prompt and defer (never remove)
 * low-relevance servers beyond the eager budget. The granted set (servers[] and
 * tools[] contents) is always identical to the input. Returns the input object
 * itself on any no-op or failure.
 */
export async function rankMcpAllowlist<T extends McpAllowlist>(
  allowlist: T | null | undefined,
  prompt: string | undefined,
  opts: RankMcpAllowlistOpts = {},
): Promise<T & { deferredServers?: string[] }> {
  const input = allowlist as T & { deferredServers?: string[] };
  const mode = getDecisionFeatureMode('tool_ranking');
  if (mode === 'off' || !allowlist || !prompt || !prompt.trim()) return input;
  if ((allowlist as { deferred?: boolean }).deferred) return input;
  if (allowlist.servers.length === 0 && allowlist.tools.length === 0) return input;

  try {
    const rawBySanitized = new Map<string, string>();
    for (const raw of Object.keys(opts.toolCounts ?? {})) rawBySanitized.set(sanitize(raw), raw);
    const known = [...new Set([...allowlist.servers, ...rawBySanitized.keys()])];
    const toolOwner = allowlist.tools.map((t) => ownerOf(t, known));
    // Candidate servers in first-seen order: servers[] then tools[] owners.
    const candidates = [...new Set([...allowlist.servers, ...toolOwner])];
    if (candidates.length < 2) return input;

    const catalog = opts.catalogToolIds ?? [];
    const textFor = (server: string): string => {
      const ids = new Set<string>();
      for (let i = 0; i < allowlist.tools.length; i++) {
        if (toolOwner[i] === server) ids.add(allowlist.tools[i]);
      }
      for (const id of catalog) {
        if (ids.size >= MAX_TOOLS_IN_TEXT) break;
        if (id.startsWith(`${server}_`)) ids.add(id);
      }
      const list = [...ids].slice(0, MAX_TOOLS_IN_TEXT);
      return list.length ? `${server}: ${list.join(', ')}` : server;
    };

    const r = await rankCandidates(
      prompt,
      candidates.map((id) => ({ id, text: textFor(id) })),
      opts.client ? { client: opts.client } : {},
    );
    const eagerK = getDecisionToolEagerServers();
    const originalEager = candidates.slice(0, eagerK);
    if (r.status !== 'ok') {
      recordDecision({
        feature: 'tool_ranking',
        mode,
        sessionId: opts.sessionId ?? null,
        status: r.status,
        applied: false,
        latencyMs: r.latencyMs,
        detail: { reason: r.reason },
      });
      return input;
    }

    const rank = new Map(r.ranked.map((x, i) => [x.id, i]));
    const minScore = getDecisionToolMinScore();
    const rankedEager = r.ranked.slice(0, eagerK).map((x) => x.id);
    const toDefer = r.ranked
      .filter((x, i) => i >= eagerK && x.score < minScore)
      .map((x) => rawBySanitized.get(x.id) ?? x.id);

    const applied = mode === 'on';
    recordDecision({
      feature: 'tool_ranking',
      mode,
      sessionId: opts.sessionId ?? null,
      status: 'ok',
      applied,
      chosen: rankedEager.join(','),
      baseline: originalEager.join(','),
      latencyMs: r.latencyMs,
      model: r.model,
      query: prompt,
      detail: {
        top: r.ranked.slice(0, 5).map((x) => ({ id: x.id, score: Number(x.score.toFixed(3)) })),
        deferred: toDefer,
        candidates: candidates.length,
      },
    });
    if (!applied) return input;

    const rk = (s: string): number => rank.get(s) ?? Number.MAX_SAFE_INTEGER;
    const servers = [...allowlist.servers].sort((a, b) => rk(a) - rk(b));
    const tools = allowlist.tools
      .map((t, i) => ({ t, k: rk(toolOwner[i]), i }))
      .sort((a, b) => a.k - b.k || a.i - b.i)
      .map((x) => x.t);
    const out = { ...allowlist, servers, tools } as T & { deferredServers?: string[] };
    if (toDefer.length > 0) {
      out.deferredServers = [...new Set([...(allowlist.deferredServers ?? []), ...toDefer])];
    }
    return out;
  } catch {
    return input;
  }
}
