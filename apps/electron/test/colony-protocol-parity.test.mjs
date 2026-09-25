import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const channel = await import('../src/colony-channel.mjs')
const artifactRoot = process.env.COLONY_NATIVE_ARTIFACT

function schema(source, name) {
  const match = source.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\n\\})`))
  assert.ok(match, `Missing ${name} schema in qualified artifact`)
  return Function(`"use strict"; return (${match[1]})`)()
}

test('1530:scene-host-selection-routing-in-the-receiver:3 keeps request and host-event fields identical to the qualified artifact', { skip: artifactRoot ? false : 'set COLONY_NATIVE_ARTIFACT to the qualified artifact' }, async () => {
  // Regression caught: Rhythm accepts a method or field shape the sealed scene cannot send/receive.
  const protocol = await readFile(path.join(artifactRoot, 'server/embedded-protocol.mjs'), 'utf8')
  const preload = await readFile(path.join(artifactRoot, 'server/embedded-preload.cjs'), 'utf8')
  assert.deepEqual(channel.COLONY_REQUEST_SCHEMAS, schema(protocol, 'schemas'))
  assert.deepEqual(channel.COLONY_HOST_EVENT_SCHEMAS, schema(preload, 'hostSchemas'))
})
