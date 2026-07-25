import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

const requiredArtifacts = [
  'apps/api_server/src/services/tailscale_serve_service.ts',
  'apps/api_server/src/services/__tests__/tailscale_serve_service.test.ts',
  'apps/desktop_flutter/lib/features/agents/data/mobile_access_data_source.dart',
  'apps/desktop_flutter/lib/features/agents/views/mobile_access_dialog.dart',
  'apps/desktop_flutter/test/features/agents/mobile_access_dialog_test.dart',
  'apps/mobile/lib/pairing/paired-host-store.ts',
  'apps/mobile/providers/paired-host-provider.tsx',
  'apps/mobile/components/settings/paired-mac-section.tsx',
  'apps/mobile/app/pair.tsx',
  'apps/mobile/tests/paired-host.test.mjs',
  'apps/api_server/src/__tests__/issue_1171_mobile_access_live.test.ts',
];

for (const relativePath of requiredArtifacts) {
  assert.equal(
    existsSync(resolve(root, relativePath)),
    true,
    `issue-1171 contract: required behavioral artifact is missing: ${relativePath}`,
  );
}

const packageJson = JSON.parse(
  readFileSync(resolve(root, 'apps/mobile/package.json'), 'utf8'),
);
assert.match(
  packageJson.scripts['verify:foundation'] ?? '',
  /test:paired-host/,
  'issue-1171-c5: the mobile foundation gate must execute paired-host tests',
);

const pairingStore = readFileSync(
  resolve(root, 'apps/mobile/lib/pairing/paired-host-store.ts'),
  'utf8',
);
assert.doesNotMatch(
  pairingStore,
  /console\.(?:log|debug|info|warn|error)\([^)]*(?:pairingCode|deviceToken|token)/,
  'issue-1171-c6: pairing code and device token must never enter logs',
);

const tailscaleService = readFileSync(
  resolve(root, 'apps/api_server/src/services/tailscale_serve_service.ts'),
  'utf8',
);
assert.doesNotMatch(
  tailscaleService,
  /(?:exec|spawn)\s*\(\s*[`'"]/,
  'issue-1171-c1/c6: Tailscale must be invoked through executable + argument arrays, never a shell string',
);

console.log('Issue #1171 acceptance contract artifact and security checks passed');
