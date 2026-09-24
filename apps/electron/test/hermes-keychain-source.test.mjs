import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

test('issue-1569-s1-c7-source: Rhythm and reviewed Hermes source read exactly Claude Code-credentials', () => {
  // Explicit source qualification. Normal Electron CI does not require a sibling checkout.
  const root = process.env.HERMES_SOURCE_ROOT
  assert.ok(root, 'HERMES_SOURCE_ROOT must name the reviewed Hermes source checkout for this separate qualification')
  const hermesPath = path.join(root, 'agent', 'anthropic_adapter.py')
  const bridgePath = new URL('../../api_server/src/services/credentials_bridge_service.ts', import.meta.url)
  const hermes = fs.readFileSync(hermesPath, 'utf8')
  const bridge = fs.readFileSync(bridgePath, 'utf8')
  assert.match(bridge, /security find-generic-password -s "Claude Code-credentials" -w/)
  assert.match(hermes, /"-s", "Claude Code-credentials"/)
})
