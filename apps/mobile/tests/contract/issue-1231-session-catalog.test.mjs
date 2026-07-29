import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertOnlineMutation,
  sanitizeOfflineChatCache,
} from '../../providers/services/agent-chat-service.ts';

const sessionServiceSource = await readFile(
  new URL('../../providers/services/session-service.ts', import.meta.url),
  'utf8',
);

test('issue-1231-c2: merged project list uses the engine identity once across bounded refreshes', () => {
  // Regression caught: active and archived responses, or repeated project
  // paths, append duplicate rows instead of retaining one project/SDK key.
  assert.match(
    sessionServiceSource,
    /listSessionsAcrossProjects\([\s\S]*new Set\(projectPaths\.filter\(Boolean\)\)/,
  );
  assert.match(
    sessionServiceSource,
    /Promise\.all\(\s*\[\s*listSessions\(scopedClient\),\s*listArchivedSessions\(scopedClient\)/,
  );
  assert.match(
    sessionServiceSource,
    /new Map\(catalog\.map\(\(session\) => \[\s*`\$\{session\.projectId\}:\$\{session\.id\}`/,
  );
});

test('issue-1231-c6: offline cache is sanitized read-only and replaced on reconnect', async () => {
  // Regression caught: credentials enter AsyncStorage, offline actions mutate
  // stale state, or reconnect never triggers an authoritative refresh.
  const cached = sanitizeOfflineChatCache([{
    id: 'ses-offline',
    projectId: 'project-a',
    title: 'Cached',
    authorization: 'Bearer secret',
    nested: { deviceToken: 'device-secret', safe: true },
  }]);
  assert.equal(JSON.stringify(cached).includes('secret'), false);
  assert.equal(cached[0].nested.safe, true);
  assert.throws(() => assertOnlineMutation(false), /offline/i);

  const providerSource = await readFile(
    new URL('../../providers/agent-chat-provider.tsx', import.meta.url),
    'utf8',
  );
  assert.match(providerSource, /isOfflineCache/);
  assert.match(
    providerSource,
    /eventStreamStatus === 'connected'[\s\S]*refresh\(\)/,
  );
  assert.match(
    providerSource,
    /setSessions\(safe\)[\s\S]*setIsOfflineCache\(false\)/,
  );
});
