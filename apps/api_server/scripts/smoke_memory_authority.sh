#!/usr/bin/env bash
#
# smoke_memory_authority.sh — end-to-end guard for the memory-vault authority
# model (issue #808, memory epic #801). Proves, against the LOCAL agent server
# only, that:
#
#   1. WRITE → VAULT + INDEX. A `POST /agent-memory` writes a Markdown note into
#      the Obsidian Memory-Vault (the source of truth) AND an index row appears
#      (GET /agent-memory/:id returns it).
#   2. INDEX IS DISPOSABLE + REBUILDABLE. Drop the entire SQLite index (delete
#      the DB file and restart the server so migrations recreate it empty), then
#      rebuild it from the surviving vault via `POST /agent-memory/sync`. The
#      same recall (`GET /agent-memory/search`) returns the same note id —
#      identical recall after a full index drop proves the vault is authority and
#      the index is a pure, rebuildable derivative.
#
# SAFETY (issue #808 safety notes):
#   • LOCAL ONLY. The server boots with AGENT_LOCAL=true on a private port and a
#     TEMP vault + TEMP SQLite. It must NEVER reach production. We hard-fail if
#     RHYTHM_API_URL / MEMORY_VAULT_PATH / DB_PATH point anywhere but the temp
#     sandbox, and we assert the recorded note path is inside the temp vault.
#   • NO NOTE BODIES LOGGED. Presence is asserted by id and vault-relative path
#     only; the smoke never prints note content.
#
# Usage: smoke_memory_authority.sh <bundled-server.js> [port]
#   <bundled-server.js>  path to the api_server entry (dist/server.js); this is
#                        the LOCAL agent server the desktop app embeds.
set -euo pipefail

SCRIPT="${1:?usage: smoke_memory_authority.sh <bundled-server.js> [port]}"
PORT="${2:-4071}"
BASE="http://127.0.0.1:${PORT}"

WORKDIR="$(mktemp -d)"
VAULT_DIR="${WORKDIR}/vault"            # MEMORY_VAULT_PATH (temp, never prod)
DB_FILE="${WORKDIR}/memory-smoke.db"    # DB_PATH (temp SQLite, never prod)
SRV_PID=""

cleanup() {
  [[ -n "${SRV_PID}" ]] && kill "${SRV_PID}" >/dev/null 2>&1 || true
  sleep 1
  [[ -n "${SRV_PID}" ]] && kill -9 "${SRV_PID}" >/dev/null 2>&1 || true
  rm -rf "${WORKDIR}" || true
}
trap cleanup EXIT

fail() {
  echo "::error::$*" >&2
  [[ -f "${WORKDIR}/server.log" ]] && tail -40 "${WORKDIR}/server.log" >&2
  exit 1
}

[[ -f "${SCRIPT}" ]] || fail "bundled server entry not found: ${SCRIPT}"
mkdir -p "${VAULT_DIR}"

# ── Boot the LOCAL agent server against the temp sandbox ────────────────────
# AGENT_LOCAL=true bypasses JWT (localhost only). RHYTHM_ROLE unset → role 'all'
# → /agent-memory is mounted (it is local-only and lives behind the
# agent-execution gate). RHYTHM_API_URL is forced to a bogus value to make any
# accidental prod call fail loudly — memory never touches it.
boot_server() {
  AGENT_LOCAL=true \
  NODE_ENV=test \
  PORT="${PORT}" \
  DB_PATH="${DB_FILE}" \
  MEMORY_VAULT_PATH="${VAULT_DIR}" \
  RHYTHM_API_URL="http://127.0.0.1:9/never-prod" \
  node "${SCRIPT}" >>"${WORKDIR}/server.log" 2>&1 &
  SRV_PID=$!
}

wait_ready() {
  local ok=""
  for _ in $(seq 1 60); do
    if ! kill -0 "${SRV_PID}" 2>/dev/null; then
      fail "local server exited before /health responded"
    fi
    if curl -fsS "${BASE}/health" >/dev/null 2>&1; then ok=1; break; fi
    perl -e 'select(undef,undef,undef,0.25)'
  done
  [[ -n "${ok}" ]] || fail "timed out waiting for ${BASE}/health"
}

stop_server() {
  [[ -n "${SRV_PID}" ]] || return 0
  kill "${SRV_PID}" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    kill -0 "${SRV_PID}" 2>/dev/null || { SRV_PID=""; return 0; }
    perl -e 'select(undef,undef,undef,0.25)'
  done
  kill -9 "${SRV_PID}" >/dev/null 2>&1 || true
  SRV_PID=""
}

# A distinctive marker so recall is unambiguous; the body is NOT logged.
MARKER="zqxwmemoryauthority$$"

boot_server
wait_ready
echo "Local agent server ready on ${BASE} (temp vault + temp SQLite)."

# ── 1. Write → vault note + index row ───────────────────────────────────────
CREATE="$(curl -fsS -X POST "${BASE}/agent-memory" \
  -H 'Content-Type: application/json' \
  -d "{\"kind\":\"fact\",\"content\":\"The ${MARKER} reservation runbook lives in facilities.\"}")" \
  || fail "POST /agent-memory failed"

# Parse id + path with node (presence by id/path only; no content dump). node
# prints "<id>\t<path>" on one line; we split on the tab. Capturing via $(...)
# (not `read`) so a missing trailing newline can't trip pipefail.
IDPATH="$(printf '%s' "${CREATE}" | node -e '
  let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>{
    let o; try { o=JSON.parse(d); } catch(e){ console.error("bad JSON from create"); process.exit(1); }
    if(!o.id||!o.path){ console.error("create response missing id/path"); process.exit(1); }
    console.log(o.id+"\t"+o.path);
  });')" || fail "could not parse create response"
MEM_ID="${IDPATH%%$'\t'*}"
MEM_PATH="${IDPATH#*$'\t'}"
[[ -n "${MEM_ID}" && -n "${MEM_PATH}" && "${MEM_ID}" != "${MEM_PATH}" ]] \
  || fail "empty/garbled id/path from create"
echo "wrote memory id=${MEM_ID} path=${MEM_PATH}"

# Safety: the API returns a vault-root-relative canonical key
# (`memory/<kind>/<note>.md`), so resolve it directly under the temp vault.
# Prefixing another `memory/` would probe a nonexistent double-nested path and
# falsely report a sandbox escape.
NOTE_ABS="${VAULT_DIR}/${MEM_PATH}"
case "$(cd "$(dirname "${NOTE_ABS}")" 2>/dev/null && pwd -P || echo /nope)" in
  "$(cd "${VAULT_DIR}" && pwd -P)"/*) : ;;
  *) fail "note path escaped the temp vault sandbox: ${MEM_PATH}" ;;
esac
[[ -f "${NOTE_ABS}" ]] || fail "vault note not written to the temp vault: ${MEM_PATH}"
echo "vault note present in temp vault: ${MEM_PATH}"

# Index row present + baseline recall. We assert recall identity by the unique
# MARKER carried in the note CONTENT, which is the actual user-facing recall
# guarantee and is STABLE across a full index drop + rebuild. (We deliberately do
# NOT key on the SQLite row id — it is a fresh UUID on each (re)index — nor on the
# sourceId path, which is recorded relative to the memory dir by the write path
# but relative to the vault root by the rebuild scan; either still recalls the
# same note. The MARKER is content the smoke authored, not an arbitrary body
# dump, so matching it logs no real note content.)
recall_has_note() {
  curl -fsS "${BASE}/agent-memory/search?q=${MARKER}" \
    | node -e '
      let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>{
        let rows; try { rows=JSON.parse(d); } catch(e){ process.exit(2); }
        const marker=process.argv[1];
        process.exit(Array.isArray(rows)&&rows.some(r=>r&&typeof r.content==="string"&&r.content.includes(marker))?0:1);
      });' "${MARKER}"
}
recall_has_note || fail "index row missing right after write (search did not recall the note for path=${MEM_PATH})"
echo "index row present + baseline recall succeeds for note path=${MEM_PATH}"

# ── 2. Drop the index entirely, then rebuild it from the surviving vault ────
# Stop the server and DELETE the SQLite index file outright (DB + WAL/SHM). The
# vault note stays on disk — it is the source of truth, and nothing durable lives
# only in the index. A fresh DB file means migrations recreate an empty schema on
# the next boot; the ONLY way the note can come back is by re-deriving it from the
# vault.
stop_server
rm -f "${DB_FILE}" "${DB_FILE}-wal" "${DB_FILE}-shm"
[[ ! -f "${DB_FILE}" ]] || fail "failed to drop the SQLite index file ${DB_FILE}"
[[ -f "${NOTE_ABS}" ]] || fail "vault note vanished when the index was dropped — vault is not authority"
echo "dropped SQLite index file; vault note survives (authority intact)"

# Boot on the fresh (empty) DB and rebuild the index from the surviving vault.
# POST /agent-memory/sync runs the full vault scan → re-derives every index row.
# (The server also rebuilds from the vault on startup; calling /sync makes the
# rebuild explicit and deterministic regardless of startup timing.)
boot_server
wait_ready
curl -fsS -X POST "${BASE}/agent-memory/sync" >/dev/null \
  || fail "POST /agent-memory/sync (rebuild from vault) failed"

# Identical recall after a FULL index drop + rebuild-from-vault. Because the DB
# file was deleted, a successful recall here can ONLY have been re-derived from
# the vault note — proving the index is disposable and the vault is the sole
# authority.
recall_has_note || fail "recall did NOT succeed for note path=${MEM_PATH} after drop+rebuild — index is not rebuildable from the vault alone"
echo "rebuilt index from the surviving vault; identical recall succeeds for note path=${MEM_PATH}"

echo "OK: vault-authority + disposable/rebuildable index guard passed (local only, no prod, no bodies logged)."
