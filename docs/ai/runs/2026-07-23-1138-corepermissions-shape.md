---
date: 2026-07-23
repo: Rhythm
branch: fix/1138-corepermissions-shape
pr: (pending)
issues: [1138]
status: verified
tags: [run, rhythm]
---

# #1138 — corePermissionsJson shape mismatch corrupts projected agent files

## Summary

The agent-file projector (`opencode_agent_writer.ts`) could project garbage
frontmatter and never self-heal:

- **parseCorePermissions was not defensive** — it returned any parsed object
  verbatim, so a corrupted DB row (e.g. the old indexed-list shape
  `{"0":{permission,pattern,action},...}` the pre-#1074 panel or a bad row
  produced) got dumped as numbered garbage keys and a bare `"permission": *`
  line (invalid YAML).
- **The merge path only upserted permission keys, never pruned** — once a
  file was polluted, PATCHing the config to a correct/reduced shape and
  re-syncing left the old keys behind; the file never converged.

## Panel investigation (item 1)

The issue's suggested item (1) was "fix the Tool Permissions panel to
serialize the flat map." On current `main` the panel
(`_agent_profile_sheet.dart`) **already** serializes the flat map
(`_corePermissions[key] = actionString` / `bash = {pattern: action}`,
`jsonEncode(_corePermissions)`), and the REST validator
(`validateCorePermissionsJson` in `agent_configs_controller.ts`) rejects the
indexed-list shape on write. The indexed-list corruption came from the
pre-#1074 state / a corrupted `creative-media` row, not current panel code.
→ No Flutter change needed. The durable, root-cause fix is backend
hardening at the projector choke point (items 2 + 3), which protects against
ANY malformed `corePermissionsJson` (legacy rows, future regressions),
regardless of how it got there.

## Fix

`apps/api_server/src/services/opencode_agent_writer.ts`:
1. `parseCorePermissions` now fail-SOFT per entry: an entry whose value isn't
   an action string (`allow`/`ask`/`deny`) or a flat `{pattern: action}` map
   (the exact contract the REST validator enforces) is logged and SKIPPED, not
   projected. Malformed JSON / non-object top level → `{}` as before.
2. New `pruneStalePermissionKeys(fm, keep)` helper; the merge path now prunes
   every `permission:` sub-key NOT in the current config — plus the
   writer-injected keys (`image_generation`/`task`/`write`) that are
   conditionally appended — so a corrected/reduced config converges. Empties
   the whole block when nothing remains.

## GitNexus

- `query()` mapped the projector, `parseCorePermissions`, and the merge loop.
- `impact({target:'writeAgentProfileFile', direction:'upstream'})` → **MEDIUM**
  (12 direct callers). Warned. My edits are internal-only (no signature/return
  contract change; still void, still never-throws), so no caller breaks —
  behavior only changes for malformed input and stale keys.
- `detect_changes()` before commit → LOW, 0 affected processes.

## Checks

- `tsc --noEmit` → 0.
- Unit: `opencode_agent_writer_projection.test.ts` (+6 new #1138 tests:
  skip indexed garbage, project valid flat map, mixed skip-bad-keep-good,
  prune stale key convergence, drop empty header, don't prune injected keys)
  + `opencode_agent_writer.test.ts` → 44 pass.
- **Live behavioral (verification gate):**
  ```
  tools/dev/sandbox.sh up   # api :4098, built from this branch
  RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
    RHYTHM_SANDBOX_HOME="$SB/home" \
    npx vitest run src/__tests__/live_e2e_1138_core_permissions.test.ts
  # → 1 passed. Created a profile with {read:allow, edit:ask}, resynced
  #   (file had both), PATCHed to {read:allow}, resynced again → projected
  #   .md no longer contained the stale `edit:` key; `read: allow` preserved;
  #   no numbered-garbage keys.
  ```

## Cleanup

- Restored `apps/opencode_fork/bun.lock` (sandbox build artifact).
- Sandbox left up for #1143.

## Next

Commit → push → draft PR for #1138, then proceed to #1143.
