// Verification evidence only: structure is not acceptance approval.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
console.log(execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim());
console.log(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
const dir = resolve(root, 'docs/ai/contracts');
const files = readdirSync(dir).filter(name => /^electron-e\d|^electron-phase3|^checkpoint-(package|inspector)/.test(name) && name.endsWith('.json'));
let malformed = 0;
for (const name of files) {
  try {
    const c = JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
    if (!Array.isArray(c.criteria) || !c.criteria.length) throw new Error('missing criteria');
    const command = c.test_command ?? c.testCommand;
    console.log(`${name}: ${c.criteria.length} criteria; command=${JSON.stringify(command ?? null)}`);
    for (const criterion of c.criteria) {
      const id = criterion.criterion_id ?? criterion.id;
      if (!criterion.test) console.log(`  BINDING_REVIEW ${id}: no per-criterion test; ${JSON.stringify(criterion)}`);
      else for (const path of criterion.test.split(';').map(s => s.trim())) {
        const file = path.split(':')[0];
        if (!existsSync(resolve(root, file)) && !existsSync(resolve(root, 'apps/api_server', file))) console.log(`  PATH_REVIEW ${id}: ${path}`);
      }
      if (/UNVERIFIED|pending|blocked/i.test(criterion.status ?? '')) console.log(`  STATUS_RECONCILE ${id}: ${criterion.status}; not_tested=${JSON.stringify(c.not_tested ?? [])}`);
    }
  } catch (error) { malformed++; console.log(`MALFORMED ${name}: ${error.message}`); }
}
console.log(`CONTRACT_STRUCTURE files=${files.length} malformed=${malformed}; execution/assertion approval remains separate`);
process.exitCode = malformed ? 1 : 0;
