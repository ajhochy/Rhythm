#!/bin/bash
# Rhythm — SessionStart hook.
# Installs dependencies so linters/tests/builds work in Claude Code on the web.
# Synchronous (blocks session start) and idempotent (safe to re-run).
set -euo pipefail

# Only run in remote (Claude Code on the web) environments. Locally the
# developer manages their own toolchain.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$ROOT"

# Root deps (workspace tooling / node-pty prebuild chmod in the root postinstall).
echo "[session-start] Installing root Node dependencies…"
npm install

# api_server deps: install INSIDE the package with --workspaces=false, exactly as
# server_ci.yml does. Root-level workspace hoisting breaks vitest's native
# rolldown binding, so this must not be a hoisted install.
if [ -d apps/api_server ]; then
  echo "[session-start] Installing + building api_server (matches server_ci.yml)…"
  (
    cd apps/api_server
    npm install --workspaces=false
    npm run build
  ) || echo "[session-start] WARN: api_server install/build failed — inspect before relying on dist/ or running tests."
fi

# Flutter deps only if the SDK is available in this environment.
if command -v flutter >/dev/null 2>&1; then
  echo "[session-start] Fetching Flutter packages…"
  ( cd apps/desktop_flutter && flutter pub get ) || \
    echo "[session-start] WARN: flutter pub get failed."
else
  echo "[session-start] Flutter SDK not present — skipping pub get (Node-only session)."
fi

echo "[session-start] Done."
