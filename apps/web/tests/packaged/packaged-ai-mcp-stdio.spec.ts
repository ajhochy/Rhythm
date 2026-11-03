import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test as unverified, type Page } from '@playwright/test';
import { test, expect, ObservedApi, assertResponse, reloadJsonFor, expectedRevision } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const inspectorTitle = '[AI MCP] private inspector advertises the bundled tools';
const stdioTitle = '[AI MCP] bundled stdio tools list and ping through the observed local API';
const requireMcp = createRequire(new URL('../../../mcp_server/package.json', import.meta.url));
const bounded = async <T>(pending: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), 12_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
};

async function observedMcp(page: Page, token: string) {
  await page.goto('rhythm://app/index.html#/tools/agent-settings?settingsSection=mcp');
  const { response, body: servers } = await reloadJsonFor<Array<{ name: string; status: string; tools: string[] }>>(page, '/opencode/mcp');
  await assertResponse(response, 'GET', '/opencode/mcp', 200);
  const api = ObservedApi.from(response);
  expect(api.origin).toBe('http://127.0.0.1:4001');
  expect(response.request().headers()['authorization']).toBe(`Bearer ${token}`);
  expect(servers).toHaveLength(1);
  expect(servers[0]).toMatchObject({ name: 'rhythm', status: 'connected' });
  expect(Array.isArray(servers[0].tools)).toBe(true);
  return { api, servers };
}

if (!manifestPath) {
  for (const title of [inspectorTitle, stdioTitle]) {
    unverified(title, () => { throw new Error('UNVERIFIED: explicit disposable synthetic actor manifest required'); });
  }
} else {
test(inspectorTitle, async ({ page }) => {
  const { manifest } = readQualificationFixture(manifestPath, expectedRevision);
  expect(manifest.syntheticActor, 'packaged MCP calls require the private actor').toBeDefined();
  const token = readFileSync(manifest.syntheticActor.tokenPath, 'utf8');
  const { servers } = await observedMcp(page, token);
  const selected = page.getByTestId('settings-column-items').getByRole('option', { selected: true });
  await expect(selected).toHaveAttribute('data-item-id', 'mcp:rhythm');
  await expect(page.getByTestId('agent-settings-mcp-status-rhythm')).toHaveText('Connected');
  await expect(page.getByTestId('agent-settings-mcp-rhythm')).toContainText(`${servers[0].tools.length} tools`);
  // The cold final recon exposed 0 here despite a healthy bundled 114-tool server.
  // Keep this gap failing until a new cold-to-ready native recon establishes timing.
  expect(servers[0].tools.length, 'UNVERIFIED: connected MCP inspector did not advertise the bundled tools').toBe(114);
});

test(stdioTitle, async ({ page, packaged }) => {
  const { manifest } = readQualificationFixture(manifestPath, expectedRevision);
  expect(manifest.syntheticActor, 'packaged MCP calls require the private actor').toBeDefined();
  const token = readFileSync(manifest.syntheticActor.tokenPath, 'utf8');
  const { api } = await observedMcp(page, token);
  const mcpRoot = path.join(packaged.appPath, 'Contents/Resources/mcp_server');
  const mcpPath = path.join(mcpRoot, 'dist/index.js');
  const nodePath = path.join(packaged.appPath, 'Contents/Resources/node/bin/node');
  expect(statSync(mcpPath).isFile()).toBe(true);
  expect(statSync(nodePath).isFile()).toBe(true);
  const { Client } = await import(pathToFileURL(requireMcp.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
  const { StdioClientTransport } = await import(pathToFileURL(requireMcp.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
  const transport = new StdioClientTransport({ command: nodePath, args: [mcpPath], cwd: mcpRoot,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: path.join(manifest.fixtureRoot, 'home'),
      RHYTHM_API_URL: api.origin, RHYTHM_AGENT_URL: api.origin, RHYTHM_API_TOKEN: token } });
  const client = new Client({ name: 'rhythm-private-qualification', version: '0.0.0' }, { capabilities: {} });
  try {
    await bounded(client.connect(transport), 'Packaged MCP stdio connect');
    const listed = await client.listTools({}, { timeout: 12_000 });
    const names = listed.tools.map((tool: { name: string }) => tool.name);
    expect(names).toHaveLength(114);
    expect(new Set(names).size).toBe(114);
    expect(names).toContain('rhythm_ping');
    expect(names).toContain('rhythm_list_tasks');
    expect(names).toContain('rhythm_create_task');
    const ping = await client.callTool({ name: 'rhythm_ping', arguments: {} }, undefined, { timeout: 12_000 });
    expect(ping.isError).not.toBe(true);
    expect(Array.isArray(ping.content) && ping.content.some((item: { type?: string; text?: string }) =>
      item.type === 'text' && item.text?.includes('Rhythm API status:'))).toBe(true);
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
});
}
