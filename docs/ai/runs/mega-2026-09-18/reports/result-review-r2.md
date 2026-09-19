> **Write status:** The sandbox rejected both `apply_patch` and `mkdir` because the workspace is mounted read-only. No files were changed. The requested report follows in full.

# Adversarial review: r2-agents-rail-profiles

**Verdict: CHANGES REQUESTED**

Reviewed the scoped `648f8d58..HEAD` changes against the original issue bodies for #1511, #1512, #1522, and #1523. No servers or browser suites were started.

## Findings

### BLOCKER — #1523 can silently destroy advanced MCP policy

`parseMcpSelection` accepts any object without validating each server value. `mcpGroupSelection` treats unsupported server values as inherited access with every catalog tool selected. The first ordinary checkbox edit then replaces that value with an array.

Evidence:

- `apps/web/src/components/profilePolicy.ts:125-159`
- `apps/web/src/components/Profiles.tsx:262-267`
- Missing edge-case coverage: `apps/web/src/components/profilePolicy.test.mjs:68-75`

Verified with a read-only probe:

```text
input   {"server":"future-mode","other":{"keep":true}}
display {"inherited":true,"selected":["a","b"]}
edited  {"server":["a"],"other":{"keep":true}}
```

This violates the requirements to represent inherited/explicit state accurately and never silently discard advanced or unknown policy data.

**One-line fix:** Treat unsupported per-server shapes as advanced/error states, disable checkbox editing for those groups, preserve the raw value, and add malformed-value round-trip tests.

### MAJOR — #1511 preferences reset instead of persisting per account

Sort, archived view, and row spacing are component-only state initialized to defaults:

- `apps/web/src/components/SessionRail.tsx:42-44`

The new test explicitly asserts reset-on-reload and the absence of preference storage:

- `apps/web/tests/agents-rail-view-options.spec.ts:51-62`

That contradicts the issue’s requirement to preserve preference persistence and account-scoped behavior.

**One-line fix:** Store sort/archive/density under the active account identity, restore them on mount and account change, and test retention plus account isolation.

### MAJOR — #1523 has no live persistence coverage

The profile tests explicitly prohibit real API requests and intercept every data endpoint:

- `apps/web/tests/profiles-editor-redesign.spec.ts:171-220`

The mocked PATCH handler mutates an in-test array, which is then treated as save/readback evidence:

- `apps/web/tests/profiles-editor-redesign.spec.ts:203-208`
- `apps/web/tests/profiles-editor-redesign.spec.ts:228-255`

This does not establish live profile persistence, server policy acceptance, or refresh/relaunch behavior.

**One-line fix:** Add and run an environment-gated isolated live test covering edit, PATCH, server readback, refresh persistence, failure retry, capability inheritance, and advanced permission preservation.

### MAJOR — #1512 collapsed parents retain active continuation controls

Child rows are gated by `expanded`, but the continuation button is an unconditional sibling whenever more children exist:

- `apps/web/src/components/SessionRail.tsx:431-455`

The test pages children but never collapses a parent:

- `apps/web/tests/agents-rail-child-loading.spec.ts:62-95`

AJ can collapse a session tree while its indented **Load subagents** row remains visible and clickable.

**One-line fix:** Render the continuation only while expanded, preferably inside the controlled children container, and add collapse/re-expand coverage.

## Expected behavior checklist

### #1511 — View options

1. **SATISFIED:** The permanent checkbox rows are replaced by one compact View options control near sort (`SessionRail.tsx:467-479`).
2. **SATISFIED:** Copy explains archive viewing and compact spacing (`SessionRail.tsx:471-476`).
3. **SATISFIED:** Selected states use `aria-checked`; archived mode has an obvious return control (`SessionRail.tsx:471-480`).
4. **PARTIAL:** Sorting, archive filtering, density, and session selection remain wired, but persistence is missing.
5. **MISSING:** Account-scoped preference persistence (`SessionRail.tsx:42-44`; `agents-rail-view-options.spec.ts:51-62`).
6. **PARTIAL:** Keyboard, screen-reader, narrow-width, RTL, theme, and simulated zoom coverage exists in browser fixtures; actual Electron behavior is not evidenced.
7. **MISSING:** Same-size before/after Electron screenshots and AJ review.

### #1512 — Child loading

1. **SATISFIED:** Large multiline buttons became compact rail-specific rows (`SessionRail.tsx:452-455`; `SessionRail.css:60-84`).
2. **SATISFIED:** Visible labels stay short while accessible names retain disambiguated parent context.
3. **SATISFIED:** Initial loading, paging, nested parents, and duplicate names have focused coverage.
4. **SATISFIED:** Busy, retry, request deduplication, row deduplication, expired cursors, and exhaustion are handled.
5. **PARTIAL:** Selection and scroll restoration are covered, but collapsing does not hide the continuation.
6. **PARTIAL:** Hit area, focus, RTL, themes, simulated zoom, and axe checks have browser fixture coverage only.
7. **MISSING:** Actual Electron screenshots and AJ review.

### #1522 — Add project

1. **SATISFIED:** Add project is visible with or without existing projects/sessions (`SessionRail.tsx:465,496`).
2. **SATISFIED:** The form supports name, manual path, and native directory selection (`SessionRail.tsx:189-203,504-513`).
3. **SATISFIED:** Creation uses `POST /projects`; validation, duplicate-submit prevention, and duplicate-directory errors are surfaced.
4. **SATISFIED:** Empty projects are inserted, expanded, selected, refreshed, and displayed before sessions exist.
5. **SATISFIED:** Instant and advanced session creation carry the selected project ID and working directory.
6. **SATISFIED:** Canceling preserves selection. Before session creation, the tests observe only the project request and no init, branch, agent, or file operation.
7. **PARTIAL:** Empty, error, retry, long-path, and focus behavior have fixture coverage, but the environment-gated live test was not executable under the no-server constraint.

### #1523 — Profile editor

1. **SATISFIED:** The profile-list/inspector structure remains intact.
2. **SATISFIED:** Identity, status, hierarchy, spacing, and seven coherent sections are present.
3. **SATISFIED:** Identity, provider/model/account, delegation, availability, capabilities, permissions, and actions remain reachable.
4. **PARTIAL:** Grouping, filtering, summaries, disclosure, and normal inherited/explicit states work; unsupported MCP policy is misrepresented and destructively editable.
5. **PARTIAL:** Core permission tests preserve unknown keys, patterns, advanced values, and inherited versus explicit-empty states. MCP advanced-value preservation remains incomplete.
6. **SATISFIED:** Normal, immediate, and destructive actions are separated; delete confirmation and default constraints remain.
7. **SATISFIED:** Dirty state, cancel, validation, saving, failure, retry, and profile-switch protection are explicit. Saves are guarded by profile ID.
8. **MISSING:** Real live persistence and readback evidence.
9. **PARTIAL:** Read-only, focus, long content, smaller windows, RTL, simulated zoom, footer clearance, and axe checks use fixtures only.
10. **MISSING:** Actual Electron before/after views and manual visual acceptance.

## What AJ will see during smoke testing

- **#1511:** Select Name sorting and Compact spacing, then reload. The rail returns to Date · newest, Comfortable, and active sessions.
- **#1512:** Collapse a parent with unloaded or paged children. Its child rows disappear while the loading continuation remains visible.
- **#1522:** No concrete contradictory behavior was found. Duplicate-directory errors surface, and Add project itself only submits the project request.
- **#1523:** A known MCP server with an advanced scalar or malformed `allowedTools` value appears as inherited with all tools selected. Changing a checkbox replaces the advanced value with a plain array.

## Verification

- Read all four issue bodies before implementation or tests.
- Inspected the scoped diffs and current line-numbered files.
- Ran `profilePolicy.test.mjs`: **11/11 passed**.
- Ran a direct read-only probe confirming the MCP policy overwrite.
- Did not run Playwright, Electron, a backend, or the sandbox.


Codex session ID: 01a0b803-b335-7f33-b104-a9121abe22a0
Resume in Codex: codex resume 01a0b803-b335-7f33-b104-a9121abe22a0
