import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrgEvaluationMcpFixture } from '../org_evaluation_mcp_fixture';

describe('controlled evaluation MCP effects', () => {
  it('advertises only the closed catalog and records actual fixture reads/actions', async () => {
    const root = mkdtempSync('/private/tmp/rhythm-evaluation-mcp-');
    try {
      mkdirSync(join(root, 'workspace', 'fixtures'), { recursive: true });
      writeFileSync(join(root, 'workspace', 'fixtures', 'request.json'), '{"task":"Summarize Actions"}');
      const fixture = new OrgEvaluationMcpFixture(root);
      const catalog = await fixture.handle({ id: 1, method: 'tools/list' });
      expect(JSON.stringify(catalog)).toContain('read_fixture');
      expect(JSON.stringify(catalog)).not.toContain('forbidden_action');
      const read = await fixture.handle({ id: 2, method: 'tools/call', params: { name: 'read_fixture', arguments: { key: 'request' } } });
      expect(JSON.stringify(read)).toContain('Summarize Actions');
      await fixture.handle({ id: 3, method: 'tools/call', params: { name: 'record_action', arguments: { value: 'Action complete' } } });
      const events = readFileSync(fixture.ledgerPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      expect(events.map(event => event.tool)).toEqual(['read_fixture', 'record_action']);
      expect(events.every(event => /^[a-f0-9]{64}$/.test(event.outputHash))).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('rejects unknown tools and path traversal without producing an effect ledger', async () => {
    const root = mkdtempSync('/private/tmp/rhythm-evaluation-mcp-');
    try {
      const fixture = new OrgEvaluationMcpFixture(root);
      expect(await fixture.handle({ id: 1, method: 'tools/call', params: { name: 'read_fixture', arguments: { key: '../../private' } } }))
        .toMatchObject({ error: { code: -32602 } });
      expect(await fixture.handle({ id: 2, method: 'tools/call', params: { name: 'forbidden_action', arguments: { value: 'No effect' } } }))
        .toMatchObject({ error: { code: -32602 } });
      expect(existsSync(fixture.ledgerPath)).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
