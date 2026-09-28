#!/usr/bin/env node
// #1574: same authenticated fake service, deliberately ignores TERM while serving.
const fs = require('node:fs');
const path = require('node:path');
const resistant = process.argv[2] === 'serve' || process.argv[2] === 'index';
if (resistant) process.on('SIGTERM', () => {
  if (process.argv[2] === 'index') {
    fs.writeFileSync(path.join(process.env.HOME, '.engraph', 'test-index-term-received'), String(process.pid));
  }
});
if (process.argv[2] === 'index') {
  // The relay can publish a child PID before this script installs its handler.
  // Let lifecycle tests wait for a child that can actually resist TERM.
  fs.writeFileSync(path.join(process.env.HOME, '.engraph', 'test-index-term-ready'), String(process.pid));
}
const run = () => {
  require('./fake_engraph_bin.js');
  if (resistant) {
    process.removeAllListeners('SIGTERM');
    process.on('SIGTERM', () => {
      if (process.argv[2] === 'index') {
        fs.writeFileSync(path.join(process.env.HOME, '.engraph', 'test-index-term-received'), String(process.pid));
      }
    });
  }
};
const delayName = process.argv[2] === 'index' ? 'test-index-delay-ms' : 'test-serve-delay-ms';
const delayFile = path.join(process.env.HOME || '', '.engraph', delayName);
const delay = (process.argv[2] === 'serve' || process.argv[2] === 'index') && fs.existsSync(delayFile)
  ? Number(fs.readFileSync(delayFile, 'utf8'))
  : 0;
if (Number.isSafeInteger(delay) && delay > 0 && delay < 10_000) setTimeout(run, delay);
else run();
