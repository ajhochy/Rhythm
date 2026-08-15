import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const vitestBin = fileURLToPath(
  new URL('../node_modules/vitest/vitest.mjs', import.meta.url),
);
const forwardedArgs = process.argv.slice(2);

function runVitest(args) {
  const result = spawnSync(process.execPath, [vitestBin, 'run', ...args], {
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error);
    return 1;
  }
  return result.status ?? 1;
}

// Keep focused developer invocations focused. A no-argument CI/full-suite run
// uses fresh, sequential processes so native SQLite/module allocations are
// released between groups and hosted runners never tear down a large fork pool.
if (forwardedArgs.length > 0) {
  process.exit(runVitest(forwardedArgs));
}

const shardCount = 16;
for (let shard = 1; shard <= shardCount; shard += 1) {
  const exitCode = runVitest([`--shard=${shard}/${shardCount}`]);
  if (exitCode !== 0) process.exit(exitCode);
}
