import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const contractUrl = new URL('./issue-shared-agents.json', import.meta.url);
const specUrl = new URL('../plans/2026-09-24-shared-agents-interface-spec.md', import.meta.url);

function sectionSixTestIds(spec) {
  const section = spec.match(/^## 6\. Slice plan$(.*?)^## 7\./ms)?.[1];
  assert.ok(section, 'the committed interface spec must contain §6');

  return [...section.matchAll(/^- \*\*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\b/gm)].map(
    ([, id]) => id,
  );
}

test('C0-R1: every §6 test ID appears exactly once in the pending contract', async () => {
  // Regression caught: a slice test is omitted, duplicated, or marked complete before evidence exists.
  const [spec, contractText] = await Promise.all([
    readFile(specUrl, 'utf8'),
    readFile(contractUrl, 'utf8'),
  ]);
  const contract = JSON.parse(contractText);
  const expectedIds = sectionSixTestIds(spec);
  const actualIds = contract.criteria.map((criterion) => criterion.criterion_id);

  assert.equal(expectedIds.length, 98, 'the frozen SA-v1 revision 2 test inventory changed');
  assert.equal(new Set(expectedIds).size, expectedIds.length, '§6 contains duplicate test IDs');
  assert.equal(new Set(actualIds).size, actualIds.length, 'the contract contains duplicate test IDs');
  assert.deepEqual(actualIds, expectedIds);
  assert.ok(
    contract.criteria.every((criterion) => criterion.status === 'pending'),
    'every shared-agent criterion must start pending',
  );
});
