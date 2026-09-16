import { spawnSync } from 'node:child_process';

// Explicit checkpoint manifest: each slice retains its own fixture/live interception mode.
const configs = [
  'gateway/electron-e13-automation.config.ts',
  ...['14', '15', '16', '20', '21', '22', '23', '24', '25a', '25b', '27', '50', '51', '52a']
    .map((slice) => `electron-e${slice}-playwright.config.ts`),
];
for (const [index, config] of [...configs, 'electron-e16-playwright.config.ts'].entries()) {
  const result = spawnSync(process.execPath, [
    'node_modules/@playwright/test/cli.js', 'test', '--config', `tests/${config}`, ...process.argv.slice(2),
  ], { stdio: 'inherit', env: { ...process.env, E16_FIXTURE: index === configs.length ? '1' : '0' } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
