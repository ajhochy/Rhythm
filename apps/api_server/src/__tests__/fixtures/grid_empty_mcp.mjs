import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).on('line', line => {
  try {
    const r = JSON.parse(line);
    if (r.id === undefined) return;
    const result = r.method === 'initialize' ? { protocolVersion: r.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'syntheticgrid-empty', version: '1' } }
      : r.method === 'tools/list' ? { tools: [] } : {};
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }) + '\n');
  } catch { process.stderr.write('GRID_MCP_REFUSED\n'); }
});
