import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const rolloutUrl = new URL('../../../docs/release/colony-rollout.md', import.meta.url)

test('1537:rollout-docs:1 the rollout doc has every required section heading', async () => {
  const doc = await readFile(rolloutUrl, 'utf8')
  const required = [
    'Data model',
    'Harness/action matrix',
    'Permissions',
    'Archive semantics',
    'Import/backup',
    'Disable',
    'Troubleshooting',
    'Updates (manual ZIP replacement)',
    'Rollback',
    'Approval checklist',
  ]
  const headings = new Set(doc.split(/\r?\n/).filter((line) => line.startsWith('## ')).map((line) => line.slice(3).trim()))
  for (const heading of required) assert.ok(headings.has(heading), `missing required heading: ## ${heading}`)
})

test('1537:rollout-docs:2 the checklist has one required row per COL-01..COL-11 receipt and states missing evidence blocks release', async () => {
  const doc = await readFile(rolloutUrl, 'utf8')
  const start = doc.indexOf('## Approval checklist')
  assert.ok(start >= 0)
  const section = doc.slice(start)
  for (let n = 1; n <= 11; n++) {
    const id = `COL-${String(n).padStart(2, '0')}`
    assert.match(section, new RegExp(`\\| ${id} \\|`), `checklist is missing a row for ${id}`)
  }
  assert.match(section, /missing arm64.*x64.*signing.*installed.*blocked/is)
})

test('1537:rollout-docs:3 the doc states the Electron/provider/Flutter gates stay separate and closing the issue publishes nothing', async () => {
  const doc = await readFile(rolloutUrl, 'utf8')
  assert.match(doc, /Electron\s+replacement/i)
  assert.match(doc, /Flutter\s+retirement|Flutter\s+cutover/i)
  assert.match(doc, /provider/i)
  assert.match(doc, /never authorizes a release|does not publish|publishes nothing/i)
})

test('1537:rollout-docs:4 the support doc exists as a companion to the rollout doc', async () => {
  const doc = await readFile(new URL('../../../docs/release/colony-support.md', import.meta.url), 'utf8')
  assert.match(doc, /colony-rollout\.md/)
})
