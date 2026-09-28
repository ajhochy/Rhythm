#!/usr/bin/env node
// Proves the "React 18.3/19.2 peer compatibility, one host-owned singleton" contract against
// a *physically separate* React 19 install, rather than aliasing a second React into this
// package's own node_modules (the previous approach: devDependency aliases "react19"/
// "react-dom19" nested into each other via a symlink script, plus Vite/Vitest resolve
// aliases to redirect every "react"/"react-dom" import). That approach worked but was
// brittle: it depended on Vite's SSR module runner treating node_modules as external
// (needing `ssr.noExternal` for any third-party React consumer like lucide-react) and on
// symlink nesting to satisfy react-dom's own internal `require("react")`.
//
// This script instead copies the package's source/tests/config into a throwaway temp
// directory, points its devDependencies at React 19.2.0 instead of 18.3.1, and runs a real
// `npm install` there — producing one, single, ordinary node_modules/react tree with no
// aliasing or symlinking involved. Plain Node/Vite module resolution just finds React 19
// because it is the only React present. The checked-in package.json/package-lock.json are
// never touched; the fixture installs into its own directory and is deleted afterward.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REACT19_VERSION = '19.2.0';
const keepFixture = process.argv.includes('--keep');

const FIXTURE_ENTRIES = ['src', 'tests', 'scripts', 'package.json', 'tsconfig.json', 'tsup.config.ts', 'vitest.config.ts'];

function copyFixture(workdir) {
  for (const entry of FIXTURE_ENTRIES) {
    const from = join(root, entry);
    if (!existsSync(from)) continue;
    cpSync(from, join(workdir, entry), {
      recursive: true,
      // Excludes debug scratch files (e.g. tests/_debug.test.ts) that never belong in a
      // gate run, regardless of whether one happens to exist on disk right now.
      filter: (src) => !basename(src).startsWith('_debug'),
    });
  }
}

function pinReact19(workdir) {
  const pkgPath = join(workdir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.name = '@ajhochy/rhythm-workspace-ui-react19-matrix-fixture';
  pkg.private = true;
  pkg.devDependencies.react = REACT19_VERSION;
  pkg.devDependencies['react-dom'] = REACT19_VERSION;
  pkg.devDependencies['@types/react'] = '^19.0.0';
  pkg.devDependencies['@types/react-dom'] = '^19.0.0';
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function installedVersion(workdir, packageName) {
  const manifestPath = join(workdir, 'node_modules', packageName, 'package.json');
  return JSON.parse(readFileSync(manifestPath, 'utf8')).version;
}

function assertNoDuplicateReact(workdir) {
  // With a single fixture-owned node_modules and no aliasing, there is exactly one place
  // ordinary Node resolution can find "react": the top-level install. If react-dom shipped
  // its own nested copy (it doesn't, but this is what would make it a real risk) it would
  // show up here.
  const nestedInReactDom = join(workdir, 'node_modules', 'react-dom', 'node_modules', 'react');
  if (existsSync(nestedInReactDom)) {
    throw new Error(`unexpected nested react copy at ${nestedInReactDom} — duplicate React instance risk`);
  }
}

const workdir = mkdtempSync(join(tmpdir(), 'rhythm-react19-matrix-'));
let vitestOutput = '';
try {
  copyFixture(workdir);
  pinReact19(workdir);

  execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: workdir, stdio: 'inherit' });

  const reactVersion = installedVersion(workdir, 'react');
  const reactDomVersion = installedVersion(workdir, 'react-dom');
  if (!reactVersion.startsWith('19.')) throw new Error(`expected react@19.x, installed ${reactVersion}`);
  if (!reactDomVersion.startsWith('19.')) throw new Error(`expected react-dom@19.x, installed ${reactDomVersion}`);
  assertNoDuplicateReact(workdir);
  console.log(`[react19-matrix] installed react@${reactVersion}, react-dom@${reactDomVersion} in an isolated tree`);

  // The bundle contract inspects fresh artifacts built with this host's React types.
  execFileSync('npm', ['run', 'build'], { cwd: workdir, stdio: 'inherit' });

  const vitestBin = join(workdir, 'node_modules', '.bin', 'vitest');
  vitestOutput = execFileSync(vitestBin, ['run', '--config', 'vitest.config.ts'], {
    cwd: workdir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  process.stdout.write(vitestOutput);

  console.log(`[react19-matrix] contract suite passed against an isolated React ${reactVersion} tree (no duplicate React).`);
} finally {
  if (keepFixture) {
    console.log(`[react19-matrix] --keep set, fixture left at ${workdir}`);
  } else {
    rmSync(workdir, { recursive: true, force: true });
  }
}
