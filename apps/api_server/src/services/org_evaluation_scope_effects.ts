import { createHash } from 'node:crypto';
import type { OrgEvaluationProposalKind, OrgEvaluationEffectProof } from '../models/org_evaluation';
import type { OrgEvaluationTargetSnapshot } from './org_evaluation_fixture';
import { prepareScopeMutation, type ScopeProposalKind } from './scope_mutation_contract';

/** Parse only the fork's complete, names-only deferred MCP catalog. A catalog
 * with omitted entries or description markup cannot establish absence. */
export interface ObservedDeferredCatalog {
  complete: boolean;
  entries: Array<{ name: string; server: string }>;
}

export function parseObservedDeferredCatalog(toolDescription: unknown): ObservedDeferredCatalog | null {
  if (typeof toolDescription !== 'string') return null;
  const opening = '<available_mcp_tools>';
  const closing = '</available_mcp_tools>';
  const start = toolDescription.indexOf(opening);
  if (start < 0 || toolDescription.indexOf(opening, start + 1) >= 0) return null;
  const end = toolDescription.indexOf(closing, start + opening.length);
  if (end < 0 || toolDescription.indexOf(closing, end + 1) >= 0
    || toolDescription.slice(end + closing.length).trim()) return null;
  const lines = toolDescription.slice(start + opening.length, end).split('\n')
    .map((line) => line.trim()).filter(Boolean);
  if (lines.shift() !== 'Use mcp_dispatch action=search to discover omitted tools, action=describe to read a selected tool\'s full schema, and action=execute to call it. MCP tools use family=mcp (default); hosted builtin tools use family=builtin.')
    return null;
  if (lines[0]?.startsWith('<builtin_tools family="builtin">')) {
    const builtinLine = lines.shift()!;
    if (!/^<builtin_tools family="builtin">[A-Za-z0-9_. -]+(?:, [A-Za-z0-9_. -]+)*<\/builtin_tools>$/.test(builtinLine)) return null;
  }
  if (lines.some((line) => line.includes('<more>'))) return null;
  if (lines.length === 1 && lines[0] === 'No MCP tools are currently available.')
    return { complete: true, entries: [] };
  const entries: ObservedDeferredCatalog['entries'] = [];
  while (lines.length) {
    if (lines.shift() !== '<mcp_tool>') return null;
    const name = /^<name>([A-Za-z0-9_.-]{1,128})<\/name>$/.exec(lines.shift() ?? '')?.[1];
    const server = /^<server>([A-Za-z0-9_.-]{1,128})<\/server>$/.exec(lines.shift() ?? '')?.[1];
    const description = /^<description>([^<>\n]*)<\/description>$/.exec(lines.shift() ?? '');
    if (!name || !server || !description || lines.shift() !== '</mcp_tool>'
      || !name.startsWith(`${server}_`) || entries.some((entry) => entry.name === name)) return null;
    entries.push({ name, server });
  }
  return { complete: true, entries };
}

type EffectEvent = Omit<OrgEvaluationEffectProof['events'][number], 'observedAt'>;
type ToolEvent = { type: string; name: string; status: string; callId: string;
  outputHash: string | null; evidenceHash: string;
  dispatch: { family: string; action: string; name: string; argumentsHash: string | null } | null };
type FixtureEvent = { tool: string; outputHash: string; server?: string };
type ProviderCatalog = { providerRequestHash: string; toolNames: string[];
  deferredCatalog: ObservedDeferredCatalog | null };
const fixtureTools = ['read_fixture', 'record_action'] as const;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const hash64 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const scopeKinds = new Set<OrgEvaluationProposalKind>(['broaden-scope', 'tighten-scope', 'prune-scope', 'refine-scope']);
const isScopeKind = (kind: OrgEvaluationProposalKind): kind is ScopeProposalKind => scopeKinds.has(kind);

/**
 * Join exact scoped engine catalog, complete tool history, and the controlled
 * fixture's recorded output. A projected allowlist by itself proves nothing.
 * The caller supplies only server IDs it registered in this private worker.
 */
export function verifyScopeDelegationEffects(input: {
  kind: OrgEvaluationProposalKind;
  changeJson: string;
  snapshot: OrgEvaluationTargetSnapshot;
  toolEvents: ToolEvent[];
  fixtureToolEvents: FixtureEvent[];
  providerToolCatalogs: ProviderCatalog[] | null;
  observedEffects: Array<{ kind: string; source: string; subject: string; evidenceHash: string }>;
  trustedFixtureServers?: readonly string[];
}): { events: EffectEvent[]; reason?: string } {
  if (input.kind === 'grant-delegation' || input.kind === 'expand-delegation')
    return { events: [], reason: 'Delegation requires actual child session ancestry and denied child routing' };
  if (!isScopeKind(input.kind)) return { events: [] };
  if (input.snapshot.kind !== input.kind)
    return { events: [], reason: 'Scope receipt differs from the frozen proposal kind' };
  const targetId = input.snapshot.targetRef.startsWith('agent_config:')
    ? input.snapshot.targetRef.slice('agent_config:'.length) : '';
  const frozen = input.snapshot.profiles.find((profile) => profile.id === targetId);
  const projection = input.observedEffects.find((event) => event.kind === 'profile-projected'
    && event.source === 'worker-file' && event.subject === targetId && hash64(event.evidenceHash));
  const catalogs = input.providerToolCatalogs;
  if (!frozen || !projection || !catalogs?.length || catalogs.some((catalog) =>
    !hash64(catalog.providerRequestHash) || !catalog.toolNames.includes('mcp_dispatch')
    || catalog.deferredCatalog?.complete !== true))
    return { events: [], reason: 'Scoped profile or complete actual engine tool catalog is missing' };
  let mutation;
  try {
    mutation = prepareScopeMutation(input.kind, input.changeJson, frozen.allowedMcpsJson);
  } catch {
    return { events: [], reason: 'Scope change cannot be derived from the frozen profile' };
  }
  if (mutation.agentConfigId !== targetId || mutation.field !== 'allowedMcpsJson')
    return { events: [], reason: 'This scope field has no controlled MCP execution proof' };
  const trusted = new Set(input.trustedFixtureServers ?? ['evaluation-fixture']);
  if (!trusted.size || [...trusted].some((name) => !/^evaluation-[a-z0-9-]{1,60}$/.test(name)))
    return { events: [], reason: 'Controlled fixture server identities are not trusted' };
  const catalogNames = new Set(catalogs.flatMap((catalog) => catalog.deferredCatalog!.entries.map((entry) => entry.name)));
  const catalogHash = sha256(JSON.stringify(catalogs.map((catalog) => ({
    request: catalog.providerRequestHash, entries: catalog.deferredCatalog!.entries,
  }))));
  const events: EffectEvent[] = [{ kind: 'scope-projected', source: 'engine-session',
    subject: targetId, evidenceHash: sha256(`${projection.evidenceHash}:${catalogHash}`) }];
  const added = new Set(mutation.add ?? []);
  const removed = new Set(mutation.remove ?? []);
  const positiveServers = added.size ? added : new Set([...trusted].filter((server) => !removed.has(server)));
  const negativeServers = removed.size ? removed : new Set([...trusted].filter((server) => !positiveServers.has(server)));
  const permitted = (server: string, tool: string): boolean => {
    const policy = JSON.parse(mutation.expectedAppliedValue) as unknown;
    if (Array.isArray(policy)) return policy.includes(server);
    if (!policy || typeof policy !== 'object') return false;
    const tools = (policy as Record<string, unknown>)[server];
    return Array.isArray(tools) && (tools.length === 0 || tools.includes(tool));
  };
  const completed = input.toolEvents.find((event) => {
    const call = event.dispatch;
    if (event.type !== 'tool' || event.name !== 'mcp_dispatch' || event.status !== 'completed'
      || !call || call.family !== 'mcp' || call.action !== 'execute' || !hash64(event.outputHash)
      || !hash64(event.evidenceHash) || !event.callId) return false;
    return [...positiveServers].some((server) => trusted.has(server) && fixtureTools.some((tool) =>
      call.name === `${server}_${tool}` && permitted(server, tool) && catalogNames.has(call.name)
      && input.fixtureToolEvents.some((ledger) => ledger.tool === tool
        && ledger.outputHash === event.outputHash
        && (ledger.server === server || ledger.server === undefined && trusted.size === 1))));
  });
  const removalKind = input.kind === 'tighten-scope' || input.kind === 'prune-scope';
  if (completed) events.push({ kind: removalKind ? 'retained-capability-executed' : 'allowed-capability-executed',
    source: 'engine-tool', subject: completed.dispatch!.name,
    evidenceHash: sha256(`${completed.evidenceHash}:${completed.outputHash}:${catalogHash}`) });
  const denied = input.toolEvents.find((event) => {
    const call = event.dispatch;
    if (event.type !== 'tool' || event.name !== 'mcp_dispatch' || event.status !== 'error'
      || !call || call.family !== 'mcp' || call.action !== 'execute' || event.outputHash !== null
      || !hash64(event.evidenceHash) || !event.callId || catalogNames.has(call.name)) return false;
    return [...negativeServers].some((server) => trusted.has(server) && fixtureTools.some((tool) =>
      call.name === `${server}_${tool}` && !permitted(server, tool)
      && !input.fixtureToolEvents.some((ledger) => ledger.tool === tool
        && (ledger.server === server || ledger.server === undefined && trusted.size === 1))));
  });
  if (denied) events.push({ kind: removalKind ? 'removed-capability-denied' : 'ungranted-capability-denied',
    source: 'engine-permission', subject: denied.dispatch!.name,
    evidenceHash: sha256(`${denied.evidenceHash}:${catalogHash}`) });
  const needed = removalKind ? ['retained-capability-executed', 'removed-capability-denied']
    : ['allowed-capability-executed', 'ungranted-capability-denied'];
  const missing = needed.filter((kind) => !events.some((event) => event.kind === kind));
  return missing.length ? { events, reason: `Actual scoped execution is missing ${missing.join(', ')}` } : { events };
}
