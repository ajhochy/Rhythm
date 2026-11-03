#!/usr/bin/env bash
# The real copier must preserve read-only approved sources and make its private runtime copy usable.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d /private/tmp/rhythm-sandbox-skills-copy-XXXXXX)"
trap 'chmod -R u+rwX "$WORK"; rm -rf "$WORK"' EXIT
mkdir -p "$WORK/sources/config/skills/original" "$WORK/home" "$WORK/outside"
printf "Outside copy sentinel\n" > "$WORK/outside/value"
chmod 400 "$WORK/outside/value"
ln -s "$WORK/outside" "$WORK/sources/config/skills/linked"
printf '{}' > "$WORK/sources/rhythm.db"
printf '{"mcp":{"rhythm":{"type":"local","command":["node","fixture.js"]}}}' > "$WORK/sources/config/opencode.json"
printf 'Original public synthetic skill\n' > "$WORK/sources/config/skills/original/SKILL.md"
chmod 400 "$WORK/sources/rhythm.db" "$WORK/sources/config/opencode.json" "$WORK/sources/config/skills/original/SKILL.md"
chmod 500 "$WORK/sources/config" "$WORK/sources/config/skills" "$WORK/sources/config/skills/original"
env -i PATH="$PATH" HOME="$WORK/home" \
  RHYTHM_APPROVED_FIXTURE_ROOT="$WORK/sources" RHYTHM_LIVE_DB_PATH="$WORK/sources/rhythm.db" \
  RHYTHM_SANDBOX_OPENCODE_CONFIG="$WORK/sources/config" RHYTHM_SANDBOX_DIR="$WORK/runtime" \
  bash -c '
    set -euo pipefail
    source "$1/tools/dev/sandbox.sh"
    validate_copied_data_inputs
    mkdir -m 700 "$SB"
    copy_runtime_files
    # This is the same operation the code-owned Reviewer seed needs after source copying.
    mkdir "$SB/home/.config/opencode/skills/new-owned-skill"
    printf "New runtime skill\n" > "$SB/home/.config/opencode/skills/new-owned-skill/SKILL.md"
    cmp "$RHYTHM_SANDBOX_OPENCODE_CONFIG/skills/original/SKILL.md" "$SB/home/.config/opencode/skills/original/SKILL.md"
    test ! -w "$RHYTHM_SANDBOX_OPENCODE_CONFIG/skills"
    test ! -w "$RHYTHM_SANDBOX_OPENCODE_CONFIG/skills/original/SKILL.md"
    test ! -e "$RHYTHM_SANDBOX_OPENCODE_CONFIG/skills/new-owned-skill"
    test -w "$SB/home/.config/opencode/skills"
    test -L "$SB/home/.config/opencode/skills/linked"
    test ! -w "${RHYTHM_APPROVED_FIXTURE_ROOT%/sources}/outside/value"
    printf "Runtime skill creation succeeded; approved source bytes and read-only modes preserved.\n"
  ' bash "$ROOT"
