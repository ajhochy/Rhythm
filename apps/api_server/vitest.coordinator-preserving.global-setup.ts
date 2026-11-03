import fs from 'node:fs';
import path from 'node:path';
import type { TestProject } from 'vitest/node';

export default function setup(project: TestProject) {
  const root = process.env.RHYTHM_TEST_FIXTURE_ROOT;
  if (process.env.NODE_ENV !== 'test' || process.env.RHYTHM_TEST_PRESERVE_FIXTURES !== '1' ||
      !root || fs.realpathSync(root) !== root || !/^\/private\/tmp\/.+/.test(root) ||
      fs.lstatSync(root).uid !== process.getuid()) throw Error('preserving runner requires explicit owned fixture root');
  const runRoot = fs.mkdtempSync(path.join(root, 'rhythm-vitest-kept-'));
  process.env.TMPDIR = root;
  project.provide('rhythmTestRunRoot', runRoot);
  return () => fs.writeFileSync(path.join(runRoot, '.retained-run.json'),
    JSON.stringify({ path: runRoot, preserved: true }) + '\n', { flag: 'wx', mode: 0o600 });
}
