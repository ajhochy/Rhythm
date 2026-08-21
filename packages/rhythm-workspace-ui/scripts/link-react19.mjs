#!/usr/bin/env node
// The devDependency aliases "react19"/"react-dom19" (npm:react@19.2.0 / npm:react-dom@19.2.0)
// let this package hold two React majors side by side to prove the "React 18.3/19.2 peer
// compatibility" contract in tests/. But react-dom's own build has an internal
// `require("react")` / `require("react-dom")` that plain Node module resolution would walk
// up and resolve to the hoisted top-level copy (18.3.1) — the wrong major, with a different
// internals shape, crashing at import time. Nesting a real copy inside react-dom19's own
// node_modules makes that internal require resolve correctly via ordinary Node resolution,
// no bundler-level aliasing required. Idempotent and safe to run on every `npm install`.
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const links = [
  { from: resolve(root, 'node_modules/react19'), to: resolve(root, 'node_modules/react-dom19/node_modules/react') },
  { from: resolve(root, 'node_modules/react-dom19'), to: resolve(root, 'node_modules/react19/node_modules/react-dom') },
];

for (const { from, to } of links) {
  if (!existsSync(from)) continue; // dev harness deps not installed (e.g. production install) — skip quietly
  mkdirSync(dirname(to), { recursive: true });
  if (existsSync(to)) rmSync(to, { recursive: true, force: true });
  symlinkSync(from, to, 'dir');
}
