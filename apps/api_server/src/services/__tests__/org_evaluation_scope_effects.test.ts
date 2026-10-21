import { describe, expect, it } from 'vitest';
import { parseObservedDeferredCatalog } from '../org_evaluation_scope_effects';

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
