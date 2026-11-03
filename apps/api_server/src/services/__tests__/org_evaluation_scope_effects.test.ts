import { describe, expect, it } from 'vitest';
import { parseObservedDeferredCatalog, verifyScopeDelegationEffects } from '../org_evaluation_scope_effects';
import type { OrgEvaluationTargetSnapshot } from '../org_evaluation_fixture';

const header = `<available_mcp_tools>\nUse mcp_dispatch action=search to discover omitted tools, action=describe to read a selected tool's full schema, and action=execute to call it. MCP tools use family=mcp (default); hosted builtin tools use family=builtin.\n`;
const entry = '  <mcp_tool>\n    <name>evaluation-fixture_read_fixture</name>\n    <server>evaluation-fixture</server>\n    <description>Read controlled data</description>\n  </mcp_tool>\n';

describe('observed deferred MCP catalog', () => {
  it('extracts a complete composed-name and server pair from the exact dispatcher description', () => {
    expect(parseObservedDeferredCatalog(`Dispatch tool\n\n${header}${entry}</available_mcp_tools>`))
      .toEqual({ complete: true, entries: [{ name: 'evaluation-fixture_read_fixture', server: 'evaluation-fixture' }] });
    expect(parseObservedDeferredCatalog(`Dispatch tool\n\n${header}  <builtin_tools family="builtin">read, bash</builtin_tools>\n${entry}</available_mcp_tools>`))
      .toEqual({ complete: true, entries: [{ name: 'evaluation-fixture_read_fixture', server: 'evaluation-fixture' }] });
  });

  it('refuses truncated, duplicated, or markup-injected catalogs as negative scope proof', () => {
    expect(parseObservedDeferredCatalog(`${header}${entry}  <more>2 additional tools are searchable on demand.</more>\n</available_mcp_tools>`)).toBeNull();
    expect(parseObservedDeferredCatalog(`${header}${entry}</available_mcp_tools>\n${header}${entry}</available_mcp_tools>`)).toBeNull();
    expect(parseObservedDeferredCatalog(`${header}${entry.replace('Read controlled data', '<name>denied_fake</name>')}</available_mcp_tools>`)).toBeNull();
    expect(parseObservedDeferredCatalog(`${header}${entry.replace('evaluation-fixture_read_fixture', 'other_read_fixture')}</available_mcp_tools>`)).toBeNull();
  });
});

const h = 'a'.repeat(64);
const output = 'b'.repeat(64);
const profile = (allowedMcpsJson: string): OrgEvaluationTargetSnapshot => ({
  schemaVersion: 1, kind: 'prune-scope', targetRef: 'agent_config:manager', targetRevision: '1',
  effectiveModel: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6', source: 'hardcoded-default' },
  profiles: [{ id: 'manager', label: 'Manager', systemPrompt: null, revision: 1,
    allowedMcpsJson, allowedSkillsJson: null, corePermissionsJson: null,
    allowedDelegatesJson: null, isManager: false, modelProvider: null, modelId: null }],
  skills: [], schedules: [], recipes: [], managedSkillFiles: [],
});
const dispatch = (name: string, status: string, outputHash: string | null) => ({
  type: 'tool', name: 'mcp_dispatch', status, callId: `${name}-${status}`,
  outputHash, evidenceHash: h,
  dispatch: { family: 'mcp', action: 'execute', name, argumentsHash: h },
});

describe('actual scope and delegation effect join', () => {
  const input = {
    kind: 'prune-scope' as const,
    changeJson: JSON.stringify({ agentConfigId: 'manager', field: 'allowedMcpsJson', remove: ['evaluation-fixture'] }),
    snapshot: profile('["evaluation-fixture","evaluation-retained"]'),
    trustedFixtureServers: ['evaluation-fixture', 'evaluation-retained'],
    observedEffects: [{ kind: 'profile-projected', source: 'worker-file', subject: 'manager', evidenceHash: h }],
    providerToolCatalogs: [{ providerRequestHash: h, toolNames: ['mcp_dispatch'],
      deferredCatalog: { complete: true, entries: [{ name: 'evaluation-retained_read_fixture', server: 'evaluation-retained' }] } }],
    toolEvents: [dispatch('evaluation-retained_read_fixture', 'completed', output),
      dispatch('evaluation-fixture_read_fixture', 'error', null)],
    fixtureToolEvents: [{ server: 'evaluation-retained', tool: 'read_fixture', outputHash: output }],
  };

  it('joins retained execution and removed denial to complete engine catalog and fixture output', () => {
    const result = verifyScopeDelegationEffects(input);
    expect(result.reason).toBeUndefined();
    expect(result.events.map(event => event.kind)).toEqual([
      'scope-projected', 'retained-capability-executed', 'removed-capability-denied',
    ]);
  });

  it('does not certify scope from projection, omitted catalog, or mismatched fixture ledger alone', () => {
    expect(verifyScopeDelegationEffects({ ...input, toolEvents: [] }).events.map(event => event.kind))
      .toEqual(['scope-projected']);
    expect(verifyScopeDelegationEffects({ ...input, providerToolCatalogs: [{ ...input.providerToolCatalogs[0],
      deferredCatalog: null }] }).events).toEqual([]);
    expect(verifyScopeDelegationEffects({ ...input, fixtureToolEvents: [{ server: 'evaluation-retained',
      tool: 'read_fixture', outputHash: h }] }).events.map(event => event.kind))
      .not.toContain('retained-capability-executed');
    expect(verifyScopeDelegationEffects({ ...input, toolEvents: [input.toolEvents[0],
      dispatch('evaluation-fixture_read_fixture', 'completed', output)] }).events.map(event => event.kind))
      .not.toContain('removed-capability-denied');
  });

  it('keeps delegation inconclusive without real child session ancestry and denial', () => {
    const result = verifyScopeDelegationEffects({ ...input, kind: 'grant-delegation' });
    expect(result.events).toEqual([]);
    expect(result.reason).toMatch(/child session ancestry/);
  });
});
