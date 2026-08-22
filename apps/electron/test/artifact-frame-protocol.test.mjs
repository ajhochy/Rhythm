import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  ARTIFACT_FRAME_BRIDGE,
  artifactFrameUrl,
  injectArtifactFrameBridge,
  parseArtifactFrameRequest,
} from '../src/artifact-frame-protocol.mjs';

const artifactId = '00000000-0000-4000-8000-000000000801';

test('artifact frame protocol accepts only an exact GET app UUID URL', () => {
  assert.equal(parseArtifactFrameRequest({ method: 'GET', url: artifactFrameUrl(artifactId) }), artifactId);
  for (const request of [
    { method: 'POST', url: artifactFrameUrl(artifactId) },
    { method: 'GET', url: `rhythm-artifact://other/${artifactId}` },
    { method: 'GET', url: `rhythm-artifact://app/${artifactId}/extra` },
    { method: 'GET', url: `rhythm-artifact://app/not-a-uuid` },
    { method: 'GET', url: `${artifactFrameUrl(artifactId)}?token=forbidden` },
    { method: 'GET', url: `${artifactFrameUrl(artifactId)}#fragment` },
  ]) assert.equal(parseArtifactFrameRequest(request), null, JSON.stringify(request));
});

test('artifact frame bridge adapts the server RhythmBridge channel before its bootstrap without rewriting artifact code', () => {
  const serverDocument = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'"><script>SERVER_BOOTSTRAP</script></head><body><main>Artifact</main><script>ARTIFACT_CODE</script></body></html>';
  const transformed = injectArtifactFrameBridge(serverDocument);
  assert.ok(transformed.indexOf(ARTIFACT_FRAME_BRIDGE) < transformed.indexOf('SERVER_BOOTSTRAP'));
  assert.match(transformed, /Object\.defineProperty\(window, 'RhythmBridge'/);
  assert.match(transformed, /__rhythmBridgeResponse/);
  assert.match(transformed, /__rhythmHostResponse/);
  assert.match(transformed, /ARTIFACT_CODE/);
  assert.doesNotMatch(transformed, /Bearer|sessionToken|authorization/i);
});

test('Electron host registers the authenticated artifact scheme and renderer uses it only inside Rhythm', async () => {
  const main = await readFile(resolve(import.meta.dirname, '../src/main.mjs'), 'utf8');
  const shell = await readFile(resolve(import.meta.dirname, '../../web/src/pages/dashboard/LiveArtifactsShell.tsx'), 'utf8');
  const html = await readFile(resolve(import.meta.dirname, '../../web/index.html'), 'utf8');
  assert.match(main, /scheme:\s*'rhythm-artifact'/);
  assert.match(main, /protocol\.handle\('rhythm-artifact'/);
  assert.match(main, /productionSessionToken/);
  assert.match(shell, /rhythm-artifact:\/\/app/);
  assert.match(shell, /sandbox="allow-scripts"/);
  assert.match(html, /frame-src[^;]*rhythm-artifact:/);
});
