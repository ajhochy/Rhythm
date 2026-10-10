import { mkdirSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { ROOT, labels } = createRequire(import.meta.url)('./grid_transport_guard.cjs');
// Manager only: creation is exclusive. Never reads or replaces existing auth/account stores.
if (process.env.HOME !== `${ROOT}/home` || process.env.TMPDIR !== `${ROOT}/tmp` ||
    realpathSync(ROOT) !== ROOT || realpathSync(process.env.HOME) !== process.env.HOME ||
    realpathSync(process.env.TMPDIR) !== process.env.TMPDIR) throw new Error('GRID_SCOPE_REFUSED');
const output = resolve(process.argv[2] ?? '');
if (!output.startsWith('/private/tmp/') || output.startsWith(`${ROOT}/`) || realpathSync(output) !== output) throw new Error('GRID_FIXTURE_ROOT_REFUSED');
const write = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  if (realpathSync(dirname(path)) !== dirname(path)) throw new Error('GRID_SYMLINK_REFUSED');
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
};
const expires = Date.now() + 365 * 86400000;
const home = process.env.HOME;
// Preflight the whole write set; an existing runtime is BLOCKED, never partially reseeded.
const planned = ['openai', 'anthropic'].map(p => `${home}/Library/Application Support/Rhythm/${p}-accounts.json`);
planned.push(`${home}/.local/share/opencode/auth.json`, `${home}/.syntheticgrid-approved`, `${output}/opencode.json`, `${output}/grid-node`);
if (planned.some(existsSync)) throw new Error('GRID_EXISTING_EVIDENCE_PRESERVED: manager must provision absent synthetic fixture paths, no overwrite');
for (const provider of ['openai', 'anthropic']) {
  const accounts = labels.filter(l => l.startsWith(provider)).map(label => ({
    id: `syntheticgrid-${label}`, label, access: `syntheticgrid-${label}-access`,
    refresh: `syntheticgrid-${label}-refresh`, expires, status: 'ok',
    ...(provider === 'openai' ? { chatgptAccountId: `syntheticgrid-${label}-workspace` } : { subscriptionType: 'max' }),
  }));
  write(`${home}/Library/Application Support/Rhythm/${provider}-accounts.json`, { version: 1, accounts, defaultAccountId: accounts[0].id, routing: {} });
}
write(`${home}/.local/share/opencode/auth.json`, { openai: {
  type: 'oauth', access: 'syntheticgrid-openai-a-access', refresh: 'syntheticgrid-openai-a-refresh',
  expires, accountId: 'syntheticgrid-openai-a-workspace',
} });
write(`${home}/.syntheticgrid-approved`, 'syntheticgrid-local-only-v1\n');
const models = Object.fromEntries(['gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6-astra'].map(id => [id, {
  id, name: id, reasoning: true, tool_call: true, limit: { context: 128000, output: 4096 },
  options: { forceReasoning: true },
  variants: Object.fromEntries(['low', 'medium', 'high'].map(e => [e, { reasoningEffort: e }])),
}]));
const anthropicModels = Object.fromEntries(['claude-sonnet-5-5', 'claude-haiku-5-5'].map(id => [id, {
  id, name: id, reasoning: true, tool_call: true, limit: { context: 128000, output: 32768 },
  variants: Object.fromEntries(Object.entries({ low: 1024, medium: 8192, high: 16384 }).map(([effort, budgetTokens]) =>
    [effort, { thinking: { type: 'enabled', budgetTokens } }])),
}]));
write(`${output}/opencode.json`, {
  plugin: [new URL('./grid_engine_transport.mjs', import.meta.url).href,
    new URL('../../../opencode_plugins/rhythm-anthropic-accounts/dist/index.js', import.meta.url).href],
  enabled_providers: ['openai', 'anthropic'], model: 'openai/gpt-6-luna',
  provider: {
    openai: { npm: '@ai-sdk/openai', options: { baseURL: 'http://127.0.0.1:7482/v1' }, models },
    anthropic: { npm: '@ai-sdk/anthropic', options: { baseURL: 'http://127.0.0.1:7482/v1' }, models: anthropicModels },
  },
  // Nonempty safe local MCP handshake with zero tools. No business tools or external dependencies.
  mcp: { 'grid-empty': { type: 'local', command: [process.execPath, fileURLToPath(new URL('./grid_empty_mcp.mjs', import.meta.url))], enabled: true } },
});
// Launcher drops ambient env; the wrapper pins preload explicitly instead of relying on NODE_OPTIONS.
write(`${output}/grid-node`, `#!/bin/sh\nexec '${process.execPath}' --require '${fileURLToPath(new URL('./grid_api_preload.cjs', import.meta.url))}' "$@"\n`);
console.info(JSON.stringify({ fixturesCreated: true, labels }));
