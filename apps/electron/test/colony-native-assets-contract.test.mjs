import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { makeArtifact, sourceCommit } from './support/colony-native-fixture.mjs'
import { resolveColonyArtifact } from '../src/colony-desktop-artifact.mjs'
let view
try { view = await import('../src/colony-view.mjs') } catch {}
async function fixture(run) {
  assert.equal(typeof view?.createColonyAssetHandler, 'function', 'Verified fixed-origin Colony asset handler is missing')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'colony-native-assets-'))
  try {
    await makeArtifact(root)
    const artifact = await resolveColonyArtifact({ artifactRoot: root, expectedSourceCommit: sourceCommit, expectedElectronMajor: 40 })
    await run({ root, handle: view.createColonyAssetHandler(artifact) })
  } finally { await fs.rm(root, { recursive: true, force: true }) }
}
test('fixed asset origin serves verified renderer with restrictive response CSP', async () => {
  await fixture(async ({ handle }) => {
    const response = await handle(new Request('rhythm-colony://app/index.html'))
    assert.equal(response.status, 200)
    assert.match(await response.text(), /Synthetic Colony/)
    assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/)
    assert.match(response.headers.get('content-security-policy'), /frame-src 'none'/)
    assert.match(response.headers.get('content-security-policy'), /object-src 'none'/)
  })
})
test('fixed asset origin never exposes worker, other origins, traversal or non-GET operations', async () => {
  await fixture(async ({ handle }) => {
    for (const url of ['rhythm-colony://foreign/index.html', 'rhythm-colony://app/server/embedded-worker.mjs',
      'rhythm-colony://app/%2e%2e%2fserver/embedded-worker.mjs', 'file:///etc/passwd', 'https://example.invalid/']) {
      const response = await handle(new Request(url))
      assert.ok(response.status >= 400, url)
    }
    assert.ok((await handle(new Request('rhythm-colony://app/index.html', { method: 'POST', body: 'x' }))).status >= 400)
  })
})
test('changed verified file refuses serving rather than trusting stale verification', async () => {
  await fixture(async ({ handle, root }) => {
    await fs.writeFile(path.join(root, 'renderer/index.html'), '<script>tampered</script>')
    const response = await handle(new Request('rhythm-colony://app/index.html'))
    assert.ok(response.status >= 400)
    assert.doesNotMatch(await response.text(), /<script>tampered/)
  })
})
