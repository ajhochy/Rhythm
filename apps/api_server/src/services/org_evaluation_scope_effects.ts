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
