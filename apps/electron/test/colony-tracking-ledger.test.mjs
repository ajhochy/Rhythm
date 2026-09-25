import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const ledgerUrl = new URL('../../../docs/ai/plans/2026-09-18-electron-colony-tracking.md', import.meta.url)
const STATUSES = ['done_needs_smoke', 'partial', 'native-pending', 'release-gated']
const ISSUES = [1526, 1527, 1528, 1529, 1530, 1531, 1532, 1533, 1534, 1535, 1536, 1537]

async function ledgerRows() {
  const doc = await readFile(ledgerUrl, 'utf8')
  const start = doc.indexOf('## Status ledger')
  assert.ok(start >= 0, 'the tracking doc must have a Status ledger section')
  const section = doc.slice(start)
  const rows = section.split(/\r?\n/).filter((line) => line.trim().startsWith('| #'))
  return { section, rows }
}

test('1525:tracking-ledger:1 every COL-01..COL-12 row names its commit(s), test command/receipt path and one enum status', async () => {
  const { rows } = await ledgerRows()
  assert.equal(rows.length, ISSUES.length, `expected exactly one ledger row per issue, got ${rows.length}`)
  for (const issue of ISSUES) {
    const row = rows.find((line) => line.includes(`#${issue} `))
    assert.ok(row, `missing ledger row for #${issue}`)
    const cells = row.split('|').map((cell) => cell.trim()).filter(Boolean)
    // cells: [issue, commit(s), test command/receipt path, status]
    assert.equal(cells.length, 4, `#${issue} row must have exactly 4 columns`)
    const [, commit, testPath, status] = cells
    assert.ok(commit.length > 0, `#${issue} must name integrated commit(s)`)
    assert.ok(testPath.length > 0, `#${issue} must name a test command or receipt path`)
    assert.ok(STATUSES.includes(status), `#${issue} status "${status}" must be one of ${STATUSES.join(', ')}`)
  }
})

test('1525:tracking-ledger:2 no ledger row claims qualification without linking the COL-11 receipt', async () => {
  const { section } = await ledgerRows()
  // Prose paragraphs wrap across lines; a table row is one line. Check each unit as a whole so a
  // qualification mention and its receipt link in the same sentence aren't split by a line break.
  for (const paragraph of section.split(/\r?\n\r?\n/)) {
    if (/qualif/i.test(paragraph)) {
      assert.match(paragraph, /colony-installed\.json/, `mentions qualification without linking the COL-11 receipt: ${paragraph}`)
    }
  }
})
