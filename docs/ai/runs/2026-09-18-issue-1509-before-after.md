---
date: 2026-09-18
repo: Rhythm
branch: mega/ws-1509-reading-comfort
pr: null
issues: [1509]
status: pending-rendered-verification
tags: [run, rhythm]
---

# Files

- `apps/web/src/styles.css`: nine dark palette properties only; light overrides unchanged.
- `apps/web/src/pages/tasks/styles.css`: list typography, wrapping, state differentiation, focus.
- `apps/web/src/components/Transcript.tsx`: co-located CSS import, named keyboard-focusable reading region, focusable tool output.
- `apps/web/src/components/Transcript.css`: scoped typography and presentation overrides.
- `apps/web/tests/reading-comfort-1509.spec.ts`: deterministic rendered assertions and screenshot attachments.
- `REPORT.md`: acceptance/verification handoff.

# Checks

Baseline: `648f8d5885b1767bcb53a95c7e8aa7eadce2c5f2`. All edits remain uncommitted.
Check results and exact commands are recorded in `REPORT.md`.
No browser, Electron, Vite server, or socket-binding smoke was run by this worker,
as required by the worker brief. Screenshot recipes below are instructions, not
claimed visual evidence. Actual computed contrast, font face, and rendered
behavior remain pending the orchestrator's run.

GitNexus upstream impact: `Transcript`, `ToolDetails`, and `RichBlock` each LOW,
one direct caller, three total dependants, zero indexed processes. No backend,
streaming, canonical-copy, history-anchor, or task mutation logic changed.

# Notes

## Selector/property inventory

Values below are authored declarations (or stated inherited/browser defaults),
not captured computed styles. Color-token changes also affect existing consumers
such as Tasks backgrounds, group rules, user bubbles, and tool separators.
The font family remains `Inter, system-ui, sans-serif`; the actual platform face
must be recorded during visual review.

### Shared dark tokens (`:root` in `apps/web/src/styles.css`)

| Property | Before → after |
| --- | --- |
| `--bg` | `oklch(0.15 0.014 185)` → `#252727` |
| `--surface` | `oklch(0.205 0.018 185)` → `#2b2e2d` |
| `--surface-warm` | `oklch(0.25 0.03 175)` → `#323735` |
| `--surface-raised` | `oklch(0.275 0.026 178)` → `#363c39` |
| `--fg` | `oklch(0.96 0.012 165)` → `#dedfdf` |
| `--fg-2` | `oklch(0.84 0.04 165)` → `#bfc6c3` |
| `--muted` | `oklch(0.72 0.035 180)` → `#a3aaa8` |
| `--border` | `oklch(0.50 0.04 183)` → `#697571` |
| `--border-soft` | `oklch(0.30 0.026 183)` → `#3e4542` |

Teal accent, semantic status colors, light-mode properties, and all other shared
rules are unchanged. The shared tokens affect the whole web/Electron shell;
cross-surface visual acceptance belongs to the orchestrator/AJ before rollout.

### Tasks (`apps/web/src/pages/tasks/styles.css`)

Every selector below has the `.pg-tasks` prefix.

| Selector | Property: before → after |
| --- | --- |
| `.task-row` | `height: 56px` → `auto` (declaration removed); `min-height: auto` → `56px`; `border-bottom: 1px solid var(--border-soft)` → `0` |
| `.task-row[aria-selected="true"]` | `background: color-mix(in oklab, var(--surface), var(--fg) 6%)` → `color-mix(in oklab, var(--surface), var(--accent) 12%)` |
| `.task-completion:disabled` | `opacity: .5` → `1` |
| `.task-completion:disabled::before` | `border-style: solid` → `dashed` |
| `.task-row h3, .task-row .task-meta` | `white-space: nowrap` → `normal`; `overflow: hidden` → `visible`; `text-overflow: ellipsis` → `clip`; `overflow-wrap: anywhere` retained on title and newly applied to metadata |
| `.task-row-copy` | `gap: 1px` → `3px` |
| `.task-row h3` | `font-size: 12px` → `14px`; `line-height: 1.35` → `20px`; `font-weight: 570` → `400` |
| `.task-meta` | `font-size: 9px` → `11px`; inherited `line-height: 1.5` → `16px` |
| `.task-tags > span` | `font-size: 8px` → `11px`; inherited `line-height: 1.5` → `16px` |
| `.task-row-main:focus-visible, .task-menu-trigger:focus-visible` | `outline-offset: 2px` → `-2px`; `outline: 2px solid var(--accent)` explicitly retained |

The card-title rule was split from the row-title rule without changing its
values. Row hover, selected accent edge (including RTL), completed strike-through,
group separators, and completion/action 44×44 CSS px sizes remain. Rows may grow
for wrapped text; no extra fixed blank row space was added.

### Transcript (`apps/web/src/components/Transcript.css`)

All selectors below have the `.transcript` prefix unless explicitly named
otherwise. Existing non-user separators are removed; the user bubble keeps its
border and receives the lighter `--surface-warm` through the shared palette.

| Selector | Property: before → after |
| --- | --- |
| `.transcript` itself | inherited `font-size: 13px` → `14px`; inherited `line-height: 1.5` → `1.6`; inherited `color: var(--fg)` and `font-weight: 400` explicitly retained |
| `.message:not(.user)` | `border-bottom: 1px solid var(--border-soft)` → `0` |
| `.message > header` | `flex-wrap: nowrap` → `wrap` |
| `.message-role` | `color: var(--fg)` → `var(--fg-2)`; `font-size: 11px` → `12px`; `font-weight: 600` → `500` |
| `.message time` | `font-size: 9px` → `11px` |
| `.markdown-copy` | `color: var(--fg-2)` → `var(--fg)`; `font-size: 13px` → `14px`; `line-height: 1.62` → `1.6`; inherited `font-weight: 400` explicitly retained |
| `.markdown-copy :is(h1, h2, h3, h4, h5, h6)` | inherited color `var(--fg-2)` → `var(--fg)`; browser bold (`700`) → `600`; inherited `line-height: 1.62` → `1.35` |
| `.markdown-copy h1` | browser `font-size: 2em` → `20px` |
| `.markdown-copy h2` | browser `font-size: 1.5em` → `18px` |
| `.markdown-copy h3` | browser `font-size: 1.17em` → `16px` |
| `.markdown-copy :is(h4, h5, h6)` | browser `font-size: 1em / .83em / .67em` → `14px` |
| `.markdown-copy strong` | browser `font-weight: bolder` (`700`) → `600` |
| `.markdown-copy :is(a, [role="link"])` | inherited `color: var(--fg-2)` retained explicitly; `text-decoration: none` on the disabled-link span → `underline`; `text-underline-offset: auto` → `.18em` |
| `.markdown-copy blockquote` | inherited `color: var(--fg-2)` retained explicitly (secondary to the new primary prose color) |
| `.markdown-copy pre` | browser `white-space: pre` → `pre-wrap`; inherited `overflow-wrap: anywhere` explicitly retained |
| `.markdown-copy pre code` | `padding: 1px 4px` → `0`; `border: 1px solid var(--border-soft)` → `0`; `background: var(--surface)` → `transparent` |
| `.markdown-copy table` | `width: auto` → `100%`; `border-collapse: separate` → `collapse` |
| `.markdown-copy :is(th, td)` | browser `padding: 1px` → `6px 8px`; `border-bottom: none` → `1px solid var(--border-soft)`; browser header center / cell start → `text-align: start` |
| `.markdown-copy th` | browser `font-weight: bold` (`700`) → `600` |
| `:is(.reasoning-block, .tool-block)` | `border-bottom: 1px solid var(--border-soft)` → `0`; top separator retained |
| `:is(.reasoning-block, .tool-block) summary` | `min-height: 38px` → `44px`; `flex-wrap: nowrap` → `wrap`; `padding-block: 0` → `6px`; `color: var(--fg-2)` → `var(--muted)`; `font-size: 11px` → `12px` |
| `:is(.reasoning-block, .tool-block) summary strong` | browser `font-weight: bolder` (`700`) → `500` |
| `:is(.reasoning-block, .tool-block) summary :is(span, small)` | `font-size: 9px` → `11px` |
| `.reasoning-block p` | `color: var(--muted)` → `var(--fg-2)`; inherited `line-height: 1.5` → `1.6` |
| `.tool-block pre` | `font-size: 10px` → `12px`; `line-height: 1.65` → `1.6` |
| `.tool-block dd` | `min-width: auto` → `0`; browser `margin-inline: 40px 0` → `9px` |
| `:is(.cost-line, .compaction-divider, .step-divider, .file-block small, .child-chip small, .inline-plan > div small, .message-attachments span)` | `font-size: 9px` → `11px` |
| `.cost-line` | `flex-wrap: nowrap` → `wrap` |
| `.message-attachments, .message-actions` | `flex-wrap: nowrap` → `wrap` |
| `.message-actions button` | `min-width: auto` → `44px`; `min-height: 30px` (44px at existing narrow breakpoint) → `44px` everywhere; `padding: 0 7px` → `0 9px`; `font-size: 9px` → `11px`; existing border 0/radius 7px/muted color/transparent background/pointer cursor explicitly retained |
| `.markdown-copy button` | browser auto minimum sizes → `min-width: 44px; min-height: 44px`; browser padding → `0 9px`; browser border → `0`; browser radius → `7px`; inherited primary color → `var(--muted)`; browser background → `transparent`; inherited size → `11px`; browser cursor → `pointer` |
| `.markdown-copy button:hover` | browser color/background → `color: var(--fg); background: color-mix(in oklab, var(--surface), var(--fg) 7%)` (same existing rule retained explicitly for `.message-actions button:hover`) |
| `:is(button, a, summary, pre):focus-visible` and `.transcript-scroll:focus-visible` | global outline offset `2px` (summary browser default) → `-2px`; `outline: 2px solid var(--accent)` explicitly applied to every listed element |
| Same focus selectors under `@media (forced-colors: active)` | outline color → system `Highlight` |

Structural attributes: `.transcript-scroll` gains `role="region"` and changes
`tabIndex=-1` → `0`; its existing accessible name remains. Each tool/diff/terminal
`pre` gains `tabIndex=0`. No canonical content is transformed. No intentional
paragraph break, paragraph margin, transcript width, or markdown maximum width
declaration changes: `width: min(100%, 840px)` and `max-width: 72ch` remain intact.

## Exact comparison setup

Use fixture mode with no live credentials/environment overrides. Use fresh browser
contexts (clear local/session storage), Chromium, locale `en-US`, timezone
`America/Los_Angeles`, reduced motion, and fixed time
`2026-08-12T15:48:00-07:00`. Set local storage `rhythm-agents-theme` to `dark`
or `light` before loading. Preserve the default pane widths/arrangement in both
captures. Reset all data and scroll positions between baseline and changed runs.

| Surface | Exact fixture URL (default port) | Viewport / zoom | Content / arrangement |
| --- | --- | --- | --- |
| Tasks | `http://127.0.0.1:4173/#/tasks` | 1440×900, 100% | Default seeded 110-task open list, no inspector, list scroll top |
| Agents | `http://127.0.0.1:4173/#/agents` | 1440×900, 100% | `session-sunday-handoff`, default rail/inspector, transcript scroll top, default collapsed tool/reasoning blocks |
| Tasks narrow | same Tasks URL | 390×844, 100%, RTL | Same defaults; additional long-title stress case is created by the spec |
| Agents narrow | same Agents URL | 390×844, 100%, RTL | Same defaults; rich markdown stress content is seeded by `openChat(..., true)` in the spec |
| Tasks zoom | same Tasks URL | 1440×900, 200% | Same defaults; spec applies `document.documentElement.style.zoom='2'` |
| Agents zoom | same Agents URL | 1440×900, 200% | Same defaults; spec applies the same root CSS zoom |

The CSS-zoom tests are automated layout probes; also perform true Electron/browser
200% zoom during visual review. Do not substitute root font-size scaling, which
would leave px-sized titles unchanged. Match window size, zoom mechanism, scroll,
selected session, expanded blocks, and pane arrangement between each pair.

Orchestrator commands (not run by worker):

```bash
cd apps/web
npx playwright test tests/reading-comfort-1509.spec.ts --workers=1
npx playwright test tests/reading-comfort-1509.spec.ts --grep 'comparison captures' --workers=1
```

The independent `comparison captures` tests attach four images (Tasks/Agents ×
dark/light) and may be copied unchanged onto the baseline for matched captures;
they do not assert the new typography. Keep the baseline checkout under orchestrator
control; this worker did not touch another worktree. The other tests assert
computed title/body typography, actual composited contrast (including hover and
selection), completion border contrast, hit areas, completion behavior, focus,
long titles, CSS zoom, RTL, markdown paragraphs/tables/code/copy, and bounded width.

The comparison tests attach Chromium platform-font JSON for the task title and
assistant paragraph. Inspect those attachments (or DevTools Rendered Fonts), then
compare screenshots with AJ. Run the existing Tasks,
E25A, E51, and E52A suites in their owning fixture/Electron configurations for
streaming, selection/copy, history anchoring, and related interactions. Run axe
and cross-surface dark-token review, including other Electron destinations.

## Ownership gap

`apps/web/src/pages/tasks/index.tsx:522` concatenates source/status, date category,
and priority into one text node. It is outside the assigned file ownership.
Selective removal of `Open · Past due` requires a rendering change there. No CSS
text hiding or DOM mutation workaround was added: either could hide meaningful
dates, source/read-only information, priority, or accessible context. Preserve
this as an explicit incomplete acceptance criterion for the orchestrator.
