import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 2026-09-28 live: opening a chat in a cold engine directory waited ~68s on
// GET /command (MCP prompt listing) because the bootstrap awaited it.
test('chat bootstrap does not await slash-command or diagnostics reads', () => {
  const source = readFileSync(
    join(__dirname, '../../providers/opencode-provider.tsx'),
    'utf8',
  );
  const start = source.indexOf('const bootstrapPromise = (async () => {');
  const awaited = source.slice(start, source.indexOf('if (!isCurrentClient(client))', start));
  const blocking = awaited.slice(awaited.lastIndexOf('await Promise.all(['));
  expect(blocking).toContain('refreshMessages(targetSession.id, true)');
  expect(blocking).not.toContain('refreshServerFeatures()');
  expect(blocking).not.toContain('refreshDiagnostics()');
  expect(awaited).toContain('settleBackgroundRead(() => Promise.all([');
});
