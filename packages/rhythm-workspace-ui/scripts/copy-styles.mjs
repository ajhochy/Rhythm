#!/usr/bin/env node
// tsup only bundles JS/TS entry points; this package's stylesheet (src/styles/, an
// @import manifest — see src/styles/rhythm.css) ships as plain CSS the host loads via the
// package's "./styles.css" export. Copying the whole directory tree into dist/ preserves the
// relative @import paths so native CSS resolution (or a host's bundler) finds every file.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'src/styles');
const to = resolve(root, 'dist/styles');

if (existsSync(to)) rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log(`copied ${from} -> ${to}`);
