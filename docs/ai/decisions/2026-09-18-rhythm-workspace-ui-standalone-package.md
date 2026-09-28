---
tags: [decision, rhythm]
---

# Keep rhythm-workspace-ui a standalone package

## Context

`packages/rhythm-workspace-ui` was rebased onto the 2026-09-18 mega branch.
It has its own package manifest, lockfile, build, and React compatibility tests.
The root workspace and lockfile cover `apps/api_server`; Watchtower deploys
from that root dependency graph.

## Decision

Keep the package standalone, with its existing `package-lock.json`. Do not
add it to root workspaces or change the root lockfile. Expose root convenience
scripts `workspace-ui:build` and `workspace-ui:test` using `npm --prefix`.
Install package dependencies separately with `npm ci` in the package directory.

React and React DOM remain host-owned peer dependencies. Test against React
18.3.1 locally and React 19.2.0 in an isolated temporary install. Both hosts
build fresh ESM/CJS artifacts before testing; bundle tests check external
imports, source-map inputs, and React runtime implementation markers.

## Alternatives

- Add the package to root workspaces: rejected because it would expand the
  API deployment dependency graph and root lockfile.
- Check only peer dependency declarations: rejected because declarations do
  not prove the emitted JavaScript excludes a second React runtime.
- Reuse the React 18 build in the React 19 fixture: rejected so the matrix
  also verifies declaration generation against the React 19 types.

## Consequences

Root installation remains scoped to the API. Package installation and its
lockfile stay independent, and callers can run the build/test scripts from
the repository root after installing package dependencies.

Tests take an additional build step and require build tooling. The React 19
matrix installs dependencies in a disposable directory and removes it after
the run. It does not modify either checked-in lockfile or the primary React
18 installation. No script syncs or vendors current `apps/web` sources;
the package maintains its own host-neutral sources and styles.
