---
date: 2026-09-28
repo: Rhythm
branch: mobile/transcript-delta-streaming
status: investigation
tags: [spec, mobile, Rhythm]
---

# Spec: Mobile session list + chat-create UI — intended vs landed

Source of truth for this document: session `1df2e7dd-db4a-45ed-a9f9-511fa9d66067`
("Mobile session list UI cleanup", 163 messages, `agent_session_messages` in
`~/Library/Application Support/Rhythm Electron/rhythm.db`, read-only), plus
`docs/ai/current-plan-1585-regressions.md`,
`docs/ai/contracts/mobile-chat-list-polish.json`, and
`docs/ai/runs/2026-09-28-mobile-chat-list-polish.md` in this worktree (all three
were written by that same session's delegated child, from the sibling worktree
`/private/tmp/rhythm-mobile-list-polish`, branch
`mobile/chat-list-compact-project-create`, draft PR #1585).

## 0. Headline finding

Contrary to the "PR #1585 only shipped the latency half" framing this task
started from: **the UI half also landed**, in commit `cf4718f7` ("Polish
mobile chat list and scope new sessions"), and is present on this branch via
merge `d2796905`. What did *not* happen is **manual visual confirmation** —
every UI acceptance criterion in the contract passed by automated Jest
assertion, but the two "-visual" criteria are explicitly marked
`UNVERIFIED: not_tested: needs manual TestFlight/simulator smoke`, and no
screenshot evidence of the actual rendered screens exists anywhere I could
find (see §4). That gap — code shipped, appearance never actually looked at —
is almost certainly what reads as "unfinished" to AJ. Section 3 ranks the
concrete remaining gaps.

## 1. Intended scope

### AJ's original requests (verbatim, from `agent_session_messages`, role=input, session 1df2e7dd…)

1. id 127909: *"Can we clean up this mobile session list UI. I want it to
   look more like the desktop session list UI. Small headers, small session
   titles, tighter margins."*
2. id 127912: *"Ok that's another bug we need to fix… sessions starting in
   the right project… maybe a small plus button on the project header like
   the desktop electron app. Also take a look at the header. It looks dumb
   and there are shape collisions w the search bar."*
3. id 127954: *"Also fix the new session creation page that you can
   attached it's pretty bad."* (sic — no further clarification exists in the
   transcript; the reviewer folded this into "compacted session-configuration
   sheet," see below. There is no mention anywhere in this session of
   attachments/file-attach UI specifically — that lives in a different
   component, `chat-composer.tsx`, which this session never touched or
   discussed.)
4. id 128103: *"Other thing since we're in the mobile app… it should
   automatically go to the bottom of the chat. Currently I have to scroll."*
   (auto-scroll — landed, see §2, not part of "the two screens" but tracked
   for completeness.)
5. id 128138: *"Also the app performance is regressing. Start new chat takes
   forever again. And the transcript streaming seems to be taking forever
   too."* (performance — out of scope for this UI spec; tracked in
   `current-plan-1585-regressions.md` / PR #1587, being worked concurrently
   by another agent in this same worktree per the task brief.)

### Reviewer's synthesis (output id 127913, before dispatch)

Quote: *"Session list: match desktop's smaller headers and titles, with
tighter margins and row spacing. Project-scoped creation: add a small + on
each project header and ensure the new session actually starts in that
project — not just displays under it. Top header: simplify the layout and
eliminate the overlapping shapes around search."*

### Explorer's dispatch note (output id 127984)

Quote: *"One slice covers all four fixes (same files): compact desktop-style
project headers + tighter rows, per-project '+' button (matching desktop's
'New session in X'), header/search de-collision (search gets its own
full-width row, smaller title), and a compacted session-configuration
sheet."* Root cause named for the wrong-project bug: `chat-list-controller.ts`
resolved the new chat's project as `filter ?? activeProjectPath ??
projects[0]` — the project the user was actually looking at was never used.

### Concrete, falsifiable criteria (from `docs/ai/contracts/mobile-chat-list-polish.json`, all attributed to that session's delegated implementer)

**(a) Session list (`chat-list.tsx`)**

- c1: "Project headers become compact, desktop-like rows while preserving
  existing test IDs."
- c2: "Session rows use 44 point minimum height, 13–14 point titles, small
  metadata and timestamp type, reduced gaps, and tight list padding."
- c3: "Each non-desktop project header exposes a 44 point New chat action
  and creates the session in that header's project." (this is the
  wrong-project bug fix + the "+" button from request #2)
- c4: "The Chats title and padding are smaller, and search occupies a
  full-width row separate from compact sort and New chat controls without
  collisions." (this is the header/search de-collision from request #2)
- race-c1/race-c2: binding the create sheet / profile list to the latest
  resolved target project, ignoring stale out-of-order profile loads —
  added during a later "UI review repair" pass inside the same session, not
  originally requested but a direct consequence of the "+"-per-project work.

**(b) Chat create page (`session-configuration-sheet.tsx`)**

- c5: "The session configuration summary uses compact Profile and Model
  List.Item rows, a tight Reasoning row, and compact Approval Policy
  controls while preserving accessibility and create/edit behavior." — this
  is the "new session creation page… pretty bad" fix (request #3).

**(c) Visual-only criteria (never automated, explicitly deferred to manual smoke)**

- c4-visual: "Visual confirmation at 375–430 point widths shows no
  header/search overlap or clipped placeholder."
- c5-visual: "Reasoning and at least the start of Approval Policy are
  visible without scrolling on an 844 point viewport."

**(d) Auto-scroll (`chat-content.tsx`)** — from request #4, added mid-session
(output id 128288: *"I missed the new auto-scroll request in the handoff.
I'll add it to the same mobile PR…"*) — scroll-c1 through scroll-c7 in the
contract. Not one of "the two screens" per se (it's the transcript view,
not the list or the create sheet) but shipped in the same PR; noted for
completeness only.

## 2. What actually landed

All three named commits are already merged into this branch (`d2796905`
merge commit, confirmed via `git log`).

| Commit | Title | Files | Maps to |
|---|---|---|---|
| `cf4718f7` | "Polish mobile chat list and scope new sessions" | `chat-list.tsx`, `chat-list-controller.ts`, `session-configuration-sheet.tsx`, `agents.tsx`, both test files | c1–c5, race-c1/c2 — **the UI work AJ asked for** |
| `d2048dda` | "Keep mobile chats pinned to recent messages" | `chat-content.tsx`, `chat-content-scroll.test.tsx` | scroll-c1..c7 (auto-scroll) |
| `6af3563c` | "Remove mobile new-chat startup waits" | `agent-chat-provider.tsx`, `opencode-provider.tsx`, two new test files, `current-plan-1585-regressions.md` | NC-1/NC-2 performance only — **no UI files touched** |

I read the current `apps/mobile/components/chat/chat-list.tsx` and
`session-configuration-sheet.tsx` in this worktree directly (not just the
contract's claims) and confirmed the code matches the criteria:

- `chat-list.tsx`: `styles.search` is a standalone full-width row
  (`{ minHeight: MinimumTouchTarget, width: '100%' }`), separate from
  `styles.toolbarActions` (sort menu + New chat button) — matches c4.
  Project header renders `projectTitle` at `TypeScale.footnote` and
  `projectCount` at `TypeScale.caption`, plus a 44×44 `projectCreate` "+"
  button per non-desktop project group that calls
  `controller.openCreateSheet(item.group.path)` — matches c1/c3. Session
  rows use `MinimumTouchTarget` row height, `title` at `footnote`,
  `metadata` at `caption`, `timestamp` at `caption2` — matches c2.
- `session-configuration-sheet.tsx`: summary rows (`summaryRow`, minHeight
  52) for Profile/Model, `SegmentedButtons density="small"` for Reasoning,
  `RadioButton.Item` rows at minHeight 44 for Approval Policy — matches c5.

So for (a) and (b) above, the code is not merely claimed-done in a run note —
it is present and structurally matches every automated criterion.

Performance work (`6af3563c`, NC-1/NC-2) and the separate streaming PR
(#1587, `ST-1`, stacked on top, currently being worked by another agent in
this same worktree per the task's stated constraints) are the *other* half
of that session's output and are correctly out of scope for "the two
screens" UI ask.

## 3. Gap table (ranked by user-visible impact)

| # | Gap | File(s) | Size | Cosmetic/Functional | Why it's a gap |
|---|---|---|---|---|---|
| 1 | **No manual visual confirmation was ever done.** c4-visual and c5-visual are the only two criteria in the whole contract marked `UNVERIFIED`/`not_tested`. Nobody has looked at the actual rendered compact header/search row at 375–430pt, or the actual compact create-sheet at an 844pt viewport, to confirm there's no overlap/clipping and that Reasoning/Approval Policy fit above the fold. | `chat-list.tsx`, `session-configuration-sheet.tsx` | Smallest possible — this is a look-at-the-simulator pass, not a code change. If it reveals a real layout bug, that's a separate, small, targeted fix (e.g. one padding/height tweak), not a rewrite. | Cosmetic (verification), but is very likely the entire reason this reads as "unfinished" to AJ — the code shipped without anyone confirming it actually looks like the desktop reference he asked for. |
| 2 | **NC-3 "instant create sheet" was explicitly deferred and never approved.** Per `current-plan-1585-regressions.md` design section and the "Deferred approval questions": the create sheet still awaits a profile-catalog network round-trip before it becomes visible (`chat-list-controller.ts` `openCreateSheet`). NC-1/NC-2 (landed in `6af3563c`) removed the *other* blocking waits (post-create sweep, cold-open GETs), but did not touch this one. Quote (128568, approved design): *"1. Optimize new-chat creation in PR #1585 and remeasure… "* — NC-3 is listed only as gated, pending `post-NC-2 M1 evidence and explicit AJ approval`, never granted in this transcript. | `apps/mobile/components/chat/chat-list-controller.ts` (`openCreateSheet`) | Small — one function stops awaiting, sheet shows immediately with an in-sheet loading state for the profile picker; the plan doc already names the exact function and approach (A3). | Functional (perceived latency on "chat create page" specifically, tap → sheet visible). Worth flagging since it's the literal "new session creation page… pretty bad" complaint's remaining edge — the summary rows are compact now, but the sheet may still take a beat to appear. |
| 3 | **No screenshots exist to compare against.** Despite the task brief's claim of "~14 PNG screenshots" left by this session, I could not find any PNG anywhere under `/private/tmp/rhythm-mega-mobile-build13`, `/private/tmp/rhythm-mobile-list-polish`, this worktree, or `/Users/ajhochhalter/Documents/Rhythm` that shows the mobile chat list, project headers, or session-configuration sheet. Every `.proof`/`.codex` PNG I found is unrelated (Electron/Hermes sign-in flow, or desktop dark-mode screenshots of Tasks/Rhythms/Dashboard/etc.). | — | N/A (investigation-only finding) | N/A | This means gap #1's manual smoke has no "before" reference image to diff against either — it will be a fresh look, not a comparison. |
| 4 | Streaming (ST-1, PR #1587) and its own manual native-device smoke remain open, but this is intentionally a separate, already-tracked, already-stacked PR being worked concurrently in this same worktree (per the task's stated constraint "Other agents are concurrently working in this worktree on streaming tests, process lifecycle, and a live simulator run"). Not re-litigated here. | `opencode-provider.tsx`, `lib/opencode/stream-reducer.ts` | — | Functional | Listed only so it isn't mistaken for part of "the two screens" scope. |

## 4. Visual baseline

**None found.** I searched:
- `/private/tmp/rhythm-mega-mobile-build13/.proof/**` and `.codex/**`
- `/private/tmp/rhythm-mobile-list-polish/.proof/**` and `.codex/**`
- `/private/tmp/rhythm-mobile-streaming-perf/.proof/**` and `.codex/**`
- `/Users/ajhochhalter/Documents/Rhythm/.proof/**`
- A repo-wide `find … -iname '*.png' -newermt '2026-09-27'` across all
  `/private/tmp/rhythm-*` worktrees.

Every PNG that turned up newer than 2026-09-27 is one of: the Hermes/Electron
sign-in and packaging proof sequence (`00-electron-sign-in.png` through
`35-signed-native-safe-login.png`), desktop dark-mode screenshots of
Tasks/Rhythms/Weekly-Planner/Dashboard/Facilities/Messages/Settings/
Integrations/Automations/Agents/Projects/Contact (`.codex/dark-mode-*`), or
unrelated app icons/provider icons in throwaway mobile probe worktrees
(`rhythm-st1-*-probe`, `rhythm-st1-baseline-mobile`). None depict the mobile
session list, project headers, or the chat-create sheet. The task brief's
"roughly 14 PNG screenshots" for this session could not be located and I am
not able to confirm they exist. **Stated plainly: no visual baseline is
available.** Manual TestFlight/simulator smoke (gap #1 above) will need to
be judged directly against the reviewer's stated intent (§1) and the desktop
Electron session list as the design reference — not against a screenshot
diff.

## 5. What I could not determine

- **The "attach" complaint (request #3) is genuinely ambiguous.** The
  transcript never clarifies what "attached" refers to; I found no mention
  of file/image attachments anywhere in this session, and the create sheet
  (`session-configuration-sheet.tsx`) has no attachment UI at all — that
  code lives in `chat-composer.tsx`/`chat-drafts.ts`, which this session
  never touched. I'm treating the reviewer's interpretation (folding it into
  "compacted session-configuration sheet," c5) as authoritative since it's
  the only interpretation any part of this session acted on, but I cannot
  confirm from the transcript that this is what AJ meant.
- **The propresenter-mcp "trap" yielded nothing.** `git -C
  /Users/ajhochhalter/Documents/propresenter-mcp diff` (read-only, not
  modified) shows only 17 lines across 5 files, all Obsidian
  frontmatter (`type: project` / `type: project-index` / `index:
  "[[propresenter-mcp]]"`) added to that repo's own `docs/ai/*` files —
  no Rhythm-mobile UI content, no misplaced spec material. This matches
  output id 127911 in the transcript, where the agent itself caught the
  cwd bug immediately (*"This session is attached to propresenter-mcp, so
  I want to confirm the app before editing"*) before writing anything
  substantive there. The known issue #1575 cwd bug appears to have fired
  only on trivial housekeeping edits, not on any real spec content.
- **Whether the manual TestFlight/simulator smoke (gap #1) will actually
  reveal a defect** — I did not run the app or the simulator myself (this
  investigation was scoped to be read-only/spec-only); I can't say whether
  the compact layout looks right until someone (or an agent with device/
  simulator access) actually looks.
- **Exact GitHub issue numbers for gaps #1/#2**, if any exist — I found no
  issue file for either in `docs/ai/` beyond the plan/contract/run-note
  already cited.
