import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) =>
  readFile(new URL(path, import.meta.url), 'utf8');

test('issue-1175: external OpenCode transcript sharing is denied and absent from mobile', async () => {
  const [
    classificationsSource,
    gatewaySource,
    workspaceSource,
    providerSource,
    providerTypesSource,
    sessionServiceSource,
  ] = await Promise.all([
    read('../contracts/rhythm-opencode-classifications.json'),
    read('../../api_server/src/services/mobile_opencode_operations.generated.ts'),
    read('../app/agents/workspace.tsx'),
    read('../providers/opencode-provider.tsx'),
    read('../providers/opencode-provider-types.ts'),
    read('../providers/services/session-service.ts'),
  ]);
  const classifications = JSON.parse(classificationsSource);
  for (const operationId of ['session.share', 'session.unshare']) {
    const operation = classifications.operations.find(
      (candidate) => candidate.operationId === operationId,
    );
    assert.equal(operation?.classification, 'intentionally-omitted');
    assert.equal(operation?.gatewayAllowed, false);
    assert.match(operation?.reason ?? '', /uploads transcript data outside Rhythm/i);
    assert.match(
      gatewaySource,
      new RegExp(
        `"operationId":"${operationId.replace('.', '\\.')}"[^\\n]+"allowed":false`,
      ),
    );
  }

  for (const [label, source] of [
    ['workspace', workspaceSource],
    ['provider', providerSource],
    ['provider types', providerTypesSource],
    ['session service', sessionServiceSource],
  ]) {
    assert.doesNotMatch(
      source,
      /\b(?:shareSession|unshareSession|svcShareSession|svcUnshareSession)\b/,
      `${label} must not retain an external transcript-sharing wrapper`,
    );
  }
  assert.doesNotMatch(
    workspaceSource,
    /Share session publicly|share-variant|title=\{session\.share/,
    'the workspace must not render the external public-share action',
  );
  assert.doesNotMatch(
    sessionServiceSource,
    /client\.session\.(?:share|unshare)\s*\(/,
    'mobile services must not call the upstream transcript upload API',
  );
});
