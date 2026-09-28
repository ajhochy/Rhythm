---
date: 2026-09-24
repo: rhythm
branch: mega/2026-09-18-mobile-electron-hermes
base: e93eac6e
issues: [1565, 1566, 1567, 1582]
status: planning (design gate — Astra review stands in for AJ approval before GPT-6 Sol codes)
tags: [plan, rhythm, electron, timestamps]
---

# Plan — #1565 One shared local timestamp formatter for `apps/web`

## Goal

Every instant timestamp in the Electron renderer should render as a short local label. The
markup should carry an ISO `dateTime` and the full date for screen readers and tooltips, and
invalid values should fall back to "Time unavailable". All of this goes through one
dependency-free module that #1566, #1567 and #1582 consume.

## Constraints

- Planning only. The coding agent is GPT-6 Sol, after Astra's review. It uses worktree
  `/private/tmp/rhythm-swarm-1565` on `swarm/issue-1565` from `e93eac6e`, and opens a draft PR
  into `mega/2026-09-18-mobile-electron-hermes`. No merge.
- No new dependency. Only `Intl.DateTimeFormat` (the issue and AJ both require this).
- Renderer only (`apps/web/src`). No api_server, gateway-mapping or wire change.
- Instants are shown in the viewer's local time. Date-only values (`YYYY-MM-DD` due/scheduled
  dates) are never converted, and are out of scope.
- No relative wording ("2m ago", "Yesterday") — see Design D3.
- Ownership boundaries (below) are binding. #1565 edits no line of `Inspector.tsx`.

## Inventory at `e93eac6e` (verified by grep; line refs are current)

### Raw or incorrect instant renders

| # | Site | Current | Live? | Owner |
|---|---|---|---|---|
| R1 | `components/Transcript.tsx:341` `message.createdAt` | raw ISO text | live | **#1565 S2** (#1582 S5 only verifies it) |
| R2 | `components/Transcript.tsx:349` queued draft `<time>Not sent</time>` | a `<time>` wrapping non-time text | live | **#1565 S2** (becomes `<span>`) |
| R3 | `components/ToolWorkspace.tsx:606` `LiveSchedulesTool` `selected.lastRunAt ?? 'Never'` | raw | live | **#1565 S2** |
| R4 | `ToolWorkspace.tsx:612` run `run.startedAt` | raw | live | **#1565 S2** |
| R5 | `ToolWorkspace.tsx:1023` `LiveReviewTool` `createdAt`/`updatedAt ?? 'Unknown'` | raw (new find) | live | **#1565 S2** |
| R6 | `ToolWorkspace.tsx:1199` `LiveEmailTool` subtitle `receivedAt \|\| createdAt` | raw in a string | live | **#1565 S2** |
| R7 | `ToolWorkspace.tsx:1210` email eyebrow | raw | live | **#1565 S2** |
| R8 | `pages/messages/live.tsx:268` + `:244` thread meta | ad-hoc `toLocaleTimeString`, time only, `''` when invalid | live | **#1565 S3** |
| R9 | `pages/messages/index.tsx:371` + `:342` | `slice(11,16)` → UTC clock | fixture | **#1565 S3** |
| R10 | `pages/facilities/live.tsx:316` subtitle, `:360` Starts/Ends, `:377` room list | raw ISO `startTime`/`endTime` (new find; the API emits `...Z`) | live | **#1565 S3** |
| R11 | `pages/mobile-access/index.tsx:289` `device.createdAt` | raw | live + fixture | **#1565 S3** |
| R12 | `pages/integrations/index.tsx:644/649/654` `Last synced ${lastSyncedAt}` | raw in a string (new find) | live | **#1565 S3** |
| R13 | `pages/automations/index.tsx:92` `dateTimeLabel` (used at `:265`, `:609`) | `slice(0,16).replace('T',' ')` (new find) | live + fixture | **#1565 S3** |
| R14 | `components/tools/AgentSettingsTool.tsx:89` `AutoPromotionSettings` `enabledAt` | raw (new find) | live | **#1565 S4**, after #1559 (its worktree has uncommitted edits to this file) |
| R15 | `components/Inspector.tsx:48` Created/Updated `Aug 12 · slice(11,16)` | hard-coded date + UTC clock | **live** (#1567 established this) | **#1567** |
| R16 | `Inspector.tsx:140` share `Expires {share.expiresAt}` | raw | live | **#1567 (addendum proposed; see Open questions 1)** |
| R17 | `Inspector.tsx:619` artifact `updatedAt.replace('T',' · ').slice(0,18)` | UTC slice | live | **#1567 (addendum proposed)** |

### Ad-hoc formatters named in the issue

| Formatter | Decision |
|---|---|
| `messages/live.tsx:36` `timeLabel` | **Delete.** Use the shared formatter (R8). |
| `planner/index.tsx:32-34` three `timeZone:'UTC'` formatters | **Keep and add a comment.** They format date-only `YYYY-MM-DD` keys anchored at UTC; converting them would shift the day. `planner:494` (`startsAt` event range) is already local via `Intl` and stays as it is. |
| `dashboard/index.tsx:676` `toLocaleDateString` | **Keep and add a comment.** It is today's local calendar date for a heading, not the label for a stored instant. |
| `dashboard/LiveArtifactsShell.tsx:23` `formatDate` | **Delete.** Use `<Timestamp>` at `:324`. It currently forces `en-US` and prints "Invalid Date" for bad input. |

### Surfaces the request asked about that need no #1565 change

- **Session list** (`SessionRail.tsx`) renders no timestamps; it only sorts by them.
- **Transcript task/child cards**: the `children` block `meta` is status text (`gateway/sessions.ts:287`), not a time.
- **Task rows** (tasks/dashboard/planner `Due 2026-09-24`, `Planned …`) show date-only values. They are a
  non-goal (see Open questions 3).
- **Reset times**: the renderer has none yet. #1566 adds them and consumes this API (see Ownership).
- **Deliberately untouched:**
  - `facilities/index.tsx` (fixture mode, wall-clock strings authored with `-07:00`);
  - `rhythms/index.tsx:110` (date-only);
  - `projects` preview `<time>` (date-only text is valid `<time>` content);
  - `packages/rhythm-workspace-ui` (separate Hermes package with the same `slice` pattern at
    `MessagesScreen.tsx:20`, `FacilitiesScreen.tsx:69` and `AutomationsScreen.tsx:65`; follow-up).

### Other findings that shaped the design

- `gateway/sessions.ts:316,369,412` and `store.tsx:114,121` fall back to `new Date(0).toISOString()`
  when a value is unknown. Without a guard, those would render "Dec 31, 1969, 4:00 PM".
- The server's SQLite `datetime('now')` columns produce **zoneless UTC** (`2026-08-05 22:23:01`). The
  server normalizes these on read only in some paths (`agent_session_messages_repository.ts:45-69`
  `toUtcIsoInstant`, `mobile_chat_catalog.ts:39-47`). Parsing a zoneless value as local caused the
  2026-08-05 seven-hour transcript bug.
- V8's `Date.parse` is lenient: `"0"` becomes the year 2000, `"2026-02-30T10:00Z"` becomes Mar 2, and
  `T24:00` becomes the next day. A plain `isNaN` check is not an honest validity test.
- Node 22.23 and Playwright Chromium emit an ASCII space before AM/PM, but tests still normalize `\s`
  in case another ICU build uses U+202F.
- Every Playwright config already pins `timezoneId:'America/Los_Angeles'` and `locale:'en-US'`.
  `tests/helpers.ts:4,35` installs a fixture clock at `2026-08-12T15:48:00-07:00`.

## Design (gate)

### Approaches

| | Approach | Trade-off |
|---|---|---|
| A | A pure `formatTimestamp()` only; each site writes its own `<time>`, tooltip, sr-only text and fallback | Smallest module, but about 15 copies of markup and fallback logic. That is the drift this issue is about. |
| **B (recommended)** | A pure `formatTimestamp()` plus one ~10-line `<Timestamp>` component that owns markup, accessibility and the fallback. String-only props (`ListInspectorItem.subtitle/meta` are `string`) use `formatTimestamp(v)?.label ?? TIME_UNAVAILABLE` | About 70 lines total and one place to change. The pure file stays `node --test`-able because it has no React import. |
| C | A relative-time engine ("2m ago", "Yesterday") with a shared ticking clock or context | Rejected. It needs timers and re-renders to stay honest, localized relative phrases, and clock-sensitive tests, and the user asked to avoid relative ambiguity. |

### D1 — API (frozen now so #1566, #1567 and #1582 can code against it)

```ts
// apps/web/src/timestamps.ts — no imports
export type TimestampOptions = { now?: number | Date; timeZone?: string; locale?: string };
export type FormattedTimestamp = { iso: string; label: string; full: string };
export const TIME_UNAVAILABLE = 'Time unavailable';
export function formatTimestamp(value: string | null | undefined, options?: TimestampOptions): FormattedTimestamp | null;

// apps/web/src/components/Timestamp.tsx
export function Timestamp(props: { value: string | null | undefined; className?: string }): JSX.Element;
```

- Omitted `timeZone`/`locale` mean the runtime default (the viewer's local settings). The options
  exist only for deterministic tests. `now` defaults to `Date.now()`.
- An invalid `timeZone` passed by a caller throws `RangeError` (caller bug, fail loud). Nothing
  from user data reaches that option.

### D2 — Parsing (a trust boundary: server data)

1. Accept only `^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})?$` after `trim()`.
2. Reject impossible components: month outside 1–12, day outside 1–days-in-month, hour above 23,
   minute or second above 59.
3. **Zoneless means UTC.** Normalize the separator to `T` and append `Z`. This mirrors
   `toUtcIsoInstant`; a zoneless value is never parsed as local.
4. Return `null` for anything else: null/undefined/empty, date-only, garbage, NaN, and
   **epoch 0** (`// ponytail: gateway "unknown" sentinel (sessions.ts/store.tsx new Date(0));
   drop when they emit ''`).
5. `iso = new Date(ms).toISOString()`, normalized to UTC `Z`, is used for `dateTime`.

### D3 — Label rules (absolute only; calendar comparison in the resolved zone)

Compare the value's and `now`'s local year-month-day from `formatToParts`. This is DST-safe
because it never subtracts milliseconds.

| Case | Options | en-US / LA example |
|---|---|---|
| Same local day | `{hour:'numeric', minute:'2-digit'}` | `1:01 PM` |
| Same local year | `{month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}` | `Sep 21, 1:01 PM` |
| Other year | same + `year:'numeric'` | `Sep 21, 2025, 1:01 PM` |

- The same rules apply to future instants (#1566 reset times), e.g. `Sep 23, 7:00 PM`.
- **"Yesterday" is not justified.** It saves about four characters over `Sep 20, 4:12 PM`, needs
  localized relative wording and capitalization, and makes a second clock-relative branch go stale
  at midnight. Adding it later is one `Intl.RelativeTimeFormat(numeric:'auto')` branch if AJ asks.
  This deviates from the #1582 plan's suggested contract; none of the #1582 S5 falsifiers depend on it.
- The hour cycle follows the locale. en-US, which is every current user, gives 12-hour AM/PM as #1010
  requires. Tests pin en-US (Open questions 2).
- `ponytail:` a same-day label can go stale if a view stays mounted past midnight without
  re-rendering. The transcript re-renders on its 2 s reconcile, and the full text is always absolute.
  Add a midnight tick only if the stale label is ever observed.

### D4 — Full text and markup

- `full`: `{weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short'}`
  gives `Monday, September 21, 2026 at 1:01 PM PDT`.
- The zone name disambiguates the DST fall-back repeated hour (`1:30 AM PDT` vs `1:30 AM PST`). It
  drops seconds; the #1582 plan suggested `timeStyle:'long'`, and S5 asserts only `September 21, 2026`.
- The three `Intl.DateTimeFormat` instances are cached in a `Map` keyed by `locale|timeZone|style`
  (`// ponytail:` the key space is tiny; this avoids ~600 constructions per streamed transcript render).

`<Timestamp>` renders exactly the #1582-agreed markup:

```tsx
<time className={className} dateTime={iso} title={full}><span aria-hidden="true">{label}</span><span className="sr-only">{full}</span></time>
// invalid or null:
<span className={className}>Time unavailable</span>
```

- `.sr-only` already exists (`styles.css:66`). No new CSS.
- **Null semantics stay with each site.** A null value that means "never happened" keeps its
  existing wording: `lastRunAt` → `Never`, automations → `Never`, integrations omit "Last synced",
  review → `Unknown`. `Time unavailable` appears only when a value is present but invalid, or for a
  required field (transcript `createdAt`, device `createdAt`).

### Ownership and coordination (binding)

| Area | Owner | Rule |
|---|---|---|
| `src/timestamps.ts`, `components/Timestamp.tsx` | #1565 S1 | No other issue creates a formatter. Downstream issues import these. |
| `Transcript.tsx` `<time>` line (R1/R2) | #1565 S2 | #1582 S5 only verifies. If #1565 **S1 has merged but S2 has not** when #1582 S5 starts, #1582 may do the one-line swap. If S1 has not merged, #1582 S5 waits and never writes a formatter. |
| `Inspector.tsx:47` gauge, usage budget, reset times | #1566 | Reset time = `<Timestamp value={item.resetAt}/>` (absolute, e.g. "Resets Sep 23, 7:00 PM"). A relative countdown ("resets 1h", Flutter parity) is #1566's product call and is not provided by #1565. |
| `Inspector.tsx:48` Created/Updated, plus R16/R17 | #1567 | Use `<Timestamp>`. Remove `Inspector.tsx` from the #1565 guard allowlist in the same PR. |
| `AgentSettingsTool.tsx` (R14) | #1565 S4 | Rebase after #1559 lands. |
| `styles.css`, `SessionRail.tsx` (PR #1577), `store.tsx` (#1579), `Shell.tsx` (#1581) | not #1565 | #1565 edits none of them. |

### User journeys (Electron renderer `rhythm://app/index.html#/…`)

| Job | Entry point | Visible success | Slice |
|---|---|---|---|
| Know when an agent message was sent | Agents → session header | `1:01 PM`; the full date on hover and for screen readers | S2 (#1582 S5 re-verifies) |
| Know when a staff message was sent | Messages → thread | Local label on the message and the thread row | S3 |
| See when a schedule last ran | Tools → Schedules | Last run and run rows are local; `Never` when null | S2 |
| See when an email signal arrived | Tools → Email | Local label in the row subtitle and the detail | S2 |
| See proposal times | Tools → Review | Local created/updated; `Unknown` when null | S2 |
| Read reservation times | Facilities → room/reservation | Local start/end | S3 |
| See when a phone was paired | Mobile access | Local label | S3 |
| See integration and automation recency | Integrations / Automations | Local label; `Never` or no text when null | S3 |
| See an artifact's last update | Dashboard → live artifact | `Updated by X · 1:01 PM` | S3 |
| See when auto-promotion was enabled | Agent settings | Local label | S4 |

Non-goals: date-only formatting, `rhythm-workspace-ui`, the Inspector (#1566/#1567), relative time,
`formatRange` for reservations, and any server-side normalization.

### Doubt review

**What would make this wrong?**
- A live endpoint might emit a timestamp shape that D2 rejects, so a real value would degrade to
  "Time unavailable".
- A viewer's Electron locale might not be en-US, giving them a 24-hour clock.

**Cheapest probe:** S0 runs every real sandbox timestamp field through `formatTimestamp` in Node.
Any `null` for a present value fails.

Primary sources checked:
- the server normalizers (`toUtcIsoInstant`);
- the SQLite defaults, which are `strftime('%Y-%m-%dT%H:%M:%fZ')` plus the `datetime('now')`
  exception;
- 229 `toISOString()` writers in the repositories;
- live Node ICU output for every example in this file.

## File structure map

| File | Responsibility | Slice |
|---|---|---|
| `apps/web/src/timestamps.ts` (new) | Parse, label, full text, cached `Intl` instances | S1 |
| `apps/web/src/timestamps.test.mjs` (new) | `node:test` matrix T1–T18 (imports `./timestamps.ts`, the same pattern as `components/profilePolicy.test.mjs`) | S1 |
| `apps/web/src/components/Timestamp.tsx` (new) | Markup, accessibility and fallback | S1 |
| `apps/web/src/components/Transcript.tsx` | R1, R2 only | S2 |
| `apps/web/src/components/ToolWorkspace.tsx` | R3–R7 | S2 |
| `apps/web/src/pages/messages/{live,index}.tsx` | R8, R9; delete both `timeLabel` | S3 |
| `apps/web/src/pages/facilities/live.tsx` | R10 | S3 |
| `apps/web/src/pages/mobile-access/index.tsx` | R11 | S3 |
| `apps/web/src/pages/integrations/index.tsx` | R12 | S3 |
| `apps/web/src/pages/automations/index.tsx` | R13; `dateTimeLabel` returns `Never` or the label | S3 |
| `apps/web/src/pages/dashboard/LiveArtifactsShell.tsx` | Delete `formatDate`; `<Timestamp>` | S3 |
| `apps/web/src/pages/dashboard/index.tsx`, `pages/planner/index.tsx` | One-line keep-reason comments only | S3 |
| `apps/web/tests/post-m1-phase-9-mobile-access.redspec.ts:87` | Replace the raw-ISO expectation | S3 |
| `apps/web/src/components/tools/AgentSettingsTool.tsx` | R14 | S4 |
| `apps/web/tests/contract/issue-1565-no-raw-timestamps.test.mjs` (new) | Static source guard (G1) | S5 |
| `apps/web/tests/issue-1565-timestamps.spec.ts` (new) | Fixture-mode Playwright P1–P7 (default config) | S5 |
| `apps/web/tests/issue-1565-live-playwright.config.ts` + `issue-1565-timestamps.live.spec.ts` (new) | Live mode with stubbed routes, L1–L9, port **4177**, extending `post-m1-phase-3-live-playwright.config.ts` like `electron-e14-playwright.config.ts` | S5 |
| `docs/ai/runs/<date>-issue-1565-timestamps.md`, `docs/ai/runs/artifacts/issue-1565/*.png` | Evidence | S5 |

## Acceptance matrix

### Formatter unit tests (S1, `node:test`; NOW = `2026-09-21T21:00:00Z`, `timeZone:'America/Los_Angeles'`, `locale:'en-US'` unless stated; compare after `.replace(/\s/g,' ')`)

| ID | Input / options | Expected |
|---|---|---|
| T1 same day | `2026-09-21T20:01:40.000Z` | label `1:01 PM`; full `Monday, September 21, 2026 at 1:01 PM PDT`; iso `2026-09-21T20:01:40.000Z` |
| T2 same UTC date, previous local day | `2026-09-21T06:59:00Z` | `Sep 20, 11:59 PM` |
| T3 east of UTC | T1 value, `timeZone:'Pacific/Kiritimati'` | `10:01 AM` (the local day is Sep 22 for both) |
| T4 same year, standard time | `2026-03-02T17:05:00Z` | `Mar 2, 9:05 AM`; full ends `PST` |
| T5 prior year | `2025-12-31T23:30:00Z` | `Dec 31, 2025, 3:30 PM` |
| T6 year boundary in local time | value `2026-01-01T07:59:00Z`, now `2026-01-01T08:30:00Z` | `Dec 31, 2025, 11:59 PM` |
| T7 DST spring-forward | `2026-03-08T09:59:00Z` / `10:30:00Z`, now `2026-03-08T20:00Z` | `1:59 AM` (PST) / `3:30 AM` (PDT) |
| T8 DST fall-back repeated hour | `2026-11-01T08:30:00Z` / `09:30:00Z`, now `2026-11-01T20:00Z` | both labels `1:30 AM`; fulls end `PDT` and `PST` respectively (distinct) |
| T9 midnight / noon | `2026-09-21T07:00:00Z` / `19:00:00Z` | `12:00 AM` / `12:00 PM` |
| T10 German locale | T1, `locale:'de-DE'`, `timeZone:'Europe/Berlin'` | `22:01`; full `Montag, 21. September 2026 um 22:01 MESZ` |
| T11 British locale | T1, `en-GB`, `Europe/London`, now `2026-09-24T12:00Z` | `21 Sept, 21:01` |
| T12 zoneless SQLite value = UTC | `2026-08-05 22:23:01` | iso `2026-08-05T22:23:01.000Z`; label `Aug 5, 3:23 PM` |
| T13 explicit offset | `2026-08-12T15:48:00-07:00` | iso `2026-08-12T22:48:00.000Z` |
| T14 invalid → `null` | `null`, `undefined`, `''`, `'  '`, `'not a date'`, `'0'`, `'1'`, `'2026-09-21'`, `'2026-02-30T10:00:00Z'`, `'2026-13-01T10:00:00Z'`, `'2026-08-05T24:00:00Z'`, `'1970-01-01T00:00:00.000Z'` | each `=== null` |
| T15 future (reset) | `2026-09-24T02:00:00Z` | `Sep 23, 7:00 PM` |
| T16 host-zone independence | the whole file under `TZ=Asia/Kolkata` and under `TZ=America/New_York` | identical pass |
| T17 sub-millisecond | `2026-09-21T20:01:40.123456Z` | iso `2026-09-21T20:01:40.123Z` |
| T18 default path uses host settings | no `timeZone`/`locale`, `now` injected, run with `TZ=America/Los_Angeles` | label `1:01 PM` |
| T19 no relative words | every label produced by T1–T18 | none matches `/ago\|yesterday\|today\|tomorrow/i` |

### Rendered, fixture mode (S5, `tests/issue-1565-timestamps.spec.ts`, default config, LA / en-US; clock from `openPage`/`openFixture` = `2026-08-12T15:48-07:00`)

| ID | Assertion |
|---|---|
| P1 transcript | In `[data-testid=transcript]`:<br>- no visible text matches `INSTANT_RE = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/`;<br>- every `article time` has a `datetime` that satisfies `!isNaN(Date.parse())` and ends in `Z`;<br>- the `[aria-hidden=true]` label matches `/^\d{1,2}:\d{2}\s[AP]M$/` for Aug 12 fixture messages;<br>- `title` equals the `.sr-only` text, and that text contains `2026`. |
| P2 queued draft | `.queued-message header` contains `Not sent` and has 0 `time` elements |
| P3 messages (fixture) | A known fixture message shows the locally computed label, not the `slice` UTC clock (assert the exact string for one fixture row) |
| P4 mobile access | `mobile-access-device-created-fixture-device-seed-1 time`:<br>- `datetime="2026-08-10T12:00:00.000Z"`;<br>- label `Aug 10, 5:00 AM`;<br>- sr-only `Monday, August 10, 2026 at 5:00 AM PDT`. |
| P5 automations | A rule with a null `lastMatchedAt` shows `Never`. A rule with a value shows a local label, not `YYYY-MM-DD HH:MM`. |
| P6 other zone/locale | `test.describe` + `test.use({ timezoneId:'Asia/Kolkata', locale:'en-GB' })`: the P4 label is `10 Aug, 17:30` and its `datetime` is unchanged |
| P7 sweep and accessibility | For routes `agents, messages, mobile-access, automations, integrations, facilities, dashboard, planner, tasks, rhythms, projects, settings`:<br>- `innerText`, after excluding `pre, code, textarea, input, [data-testid="page-trace"]` (each exclusion commented), has 0 `INSTANT_RE` matches;<br>- every `time[datetime]` parses;<br>- axe (`@axe-core/playwright`) reports 0 serious/critical issues on the transcript header and the mobile-access device list. |

### Rendered, live mode with stubbed routes (S5; port 4177; `page.clock.setFixedTime(new Date('2026-09-21T21:00:00Z'))`; `page.route` JSON with fixed ISO values)

| ID | Surface → expected |
|---|---|
| L1 | messages/live: message `2026-09-21T20:01:40.000Z` shows label `1:01 PM`, and the thread-row meta shows `1:01 PM` |
| L2 | facilities/live: reservation `2026-09-22T16:00:00.000Z`–`17:00:00.000Z` shows subtitle `Sep 22, 9:00 AM - Sep 22, 10:00 AM`; Starts/Ends are `<time>` elements with ISO `datetime` |
| L3 | Schedules: `lastRunAt` `2026-09-20T15:30:00.000Z` shows `Sep 20, 8:30 AM`; null shows `Never`; the run row `startedAt` is formatted |
| L4 | Email: subtitle `Sender · 1:01 PM`; the eyebrow is a `<time>` |
| L5 | Review: created/updated are formatted; null shows `Unknown` |
| L6 | Integrations: `Last synced Sep 21, 12:00 PM` for `2026-09-21T19:00:00.000Z`; a null value shows no "Last synced" text |
| L7 | Live artifact: `Updated by <name> · 1:01 PM` |
| L8 | Invalid (`'garbage'`) on one row each of messages/live, email and schedules run shows `Time unavailable`; the page stays interactive (the next row can still be selected) |
| L9 | Zoneless `2026-09-21 20:01:40` on one messages/live row shows `1:01 PM` |
| L10 (S4) | Auto-promotion `enabledAt` is formatted (added after #1559) |

### Static guard (S5, `tests/contract/issue-1565-no-raw-timestamps.test.mjs`, `node:test`)

**G1.** Scan `apps/web/src/**/*.tsx`. Fail on any of these patterns:
- `\.slice\(11,\s*16\)`
- `\.slice\(0,\s*16\)`
- `\.replace\('T',`
- `toLocaleTimeString\(`
- JSX or template interpolation of a bare `…At` / `…Time` / `…Timestamp` member (`\{[\w.?]+(At|Time)\}`, `\$\{[\w.?]+(At|Time)\}`, `\{[\w.?]+At \?\? '`, `\|\| [\w.]+At\}`).

The allowlist is explicit, and each entry carries a reason:
- `pages/facilities/index.tsx` — fixture wall-clock strings;
- `components/Inspector.tsx` — owned by #1567, which removes this entry;
- `components/tools/AgentSettingsTool.tsx` — until S4.

`ponytail:` this is a regex heuristic; the DOM checks P7/L* are the behavioral guard. The test also
proves G1 bites: a fixture string containing `{run.startedAt}` must fail the pattern set.

## Issue table

| # | Title | Likely files | Acceptance (falsifiable) | Depends on | Required validation | Parallel? |
|---|---|---|---|---|---|---|
| S0 | Real timestamp-shape probe (read-only) | none committed; output goes in the run log | Every present timestamp field from sandbox `GET` responses returns non-null from `formatTimestamp`. Sources: `/agent-sessions?limit=5` plus one detail's messages, and, for each surface R3–R14, the list endpoint that surface's live gateway calls (take the paths from `apps/web/src/gateway/*.ts`; do not guess them). Endpoints with no rows are listed as "no data". | S1 file exists; operator fixture root | `tools/dev/sandbox.sh up` → `curl` each endpoint on `127.0.0.1:4098` → `node -e` import `apps/web/src/timestamps.ts` and map the fields → `tools/dev/sandbox.sh down`. If the fixture root is unavailable, record BLOCKED plus the static evidence (the `toUtcIsoInstant` / `strftime(...Z)` refs). This does not block S1–S4. | After S1 |
| S1 | Shared formatter and `<Timestamp>` | `src/timestamps.ts`, `src/timestamps.test.mjs`, `src/components/Timestamp.tsx` | T1–T19 pass. API exactly as D1. Zero imports in `timestamps.ts`. No new `package.json` dependency. | none | `cd apps/web && node --test src/timestamps.test.mjs && TZ=Asia/Kolkata node --test src/timestamps.test.mjs && TZ=America/New_York node --test src/timestamps.test.mjs && npm run typecheck`; `git diff e93eac6e -- apps/web/package.json` is empty | First |
| S2 | Agent surfaces use it | `components/Transcript.tsx` (R1/R2 lines only), `components/ToolWorkspace.tsx` (R3–R7) | P1, P2, L3, L4, L5, L8 (email/schedules). `Never`/`Unknown` null wording is preserved. The Transcript diff is ≤ 2 lines, apart from the import. | S1 | `npm run typecheck`; `npx playwright test tests/issue-1565-timestamps.spec.ts -g "P1\|P2"`; `npx playwright test -c tests/issue-1565-live-playwright.config.ts -g "L3\|L4\|L5\|L8"`; existing `npx playwright test -c tests/electron-e52a-playwright.config.ts` and `-c tests/electron-e25a-playwright.config.ts` stay green | Yes, with S3 (disjoint files) |
| S3 | Collaboration pages use it; delete the ad-hoc formatters | `pages/messages/{live,index}.tsx`, `pages/facilities/live.tsx`, `pages/mobile-access/index.tsx`, `pages/integrations/index.tsx`, `pages/automations/index.tsx`, `pages/dashboard/LiveArtifactsShell.tsx`, comment-only in `pages/dashboard/index.tsx` and `pages/planner/index.tsx`, `tests/post-m1-phase-9-mobile-access.redspec.ts:87` | P3–P6, L1, L2, L6, L7, L8 (messages), L9. `rg -n "function timeLabel\|function formatDate" apps/web/src` is empty. The planner UTC pins and dashboard `:676` each carry a keep-reason comment. | S1 | `npm run typecheck`; `npx playwright test tests/issue-1565-timestamps.spec.ts -g "P3\|P4\|P5\|P6"`; `-c tests/issue-1565-live-playwright.config.ts -g "L1\|L2\|L6\|L7\|L9"`; existing `npx playwright test tests/contract/issue-2006-messages.spec.ts tests/contract/issue-2007-facilities.spec.ts tests/contract/issue-2008-automations.spec.ts tests/contract/issue-2009-integrations.spec.ts tests/contract/issue-2002-planner.spec.ts --workers=1` and `npx playwright test -c tests/gateway/post-m1-phase-9-mobile-access-live-playwright.config.ts` stay green | Yes, with S2 |
| S4 | Auto-promotion `enabledAt` | `components/tools/AgentSettingsTool.tsx` | L10. `AgentSettingsTool.tsx` is removed from the G1 allowlist. The existing `bucket-a-rendered-repair.spec.ts:497` (`Enabled`) stays green. | S1, **#1559 merged** | `npx playwright test --config tests/bucket-a-rendered-repair-playwright.config.ts`; L10; G1 | After #1559; may trail the PR as a follow-up commit |
| S5 | Guards, evidence and sandbox pass | `tests/contract/issue-1565-no-raw-timestamps.test.mjs`, `tests/issue-1565-timestamps.spec.ts` (P7 plus the shared helpers), the live config and spec, the run log and screenshots | G1 passes with only the documented allowlist. P7 passes. Screenshots saved (evidence only, **not** golden-compared): transcript header plus hover tooltip, messages/live, schedules run history, email detail, mobile-access device, one `Time unavailable` row, and P6 en-GB/Kolkata. On the sandbox, the transcript and messages show 0 raw instants and 0 `Time unavailable` for server-supplied values. | S2, S3 (S4 for the final G1 allowlist) | `node --test tests/contract/issue-1565-no-raw-timestamps.test.mjs`; `npx playwright test tests/issue-1565-timestamps.spec.ts`; `npx playwright test -c tests/issue-1565-live-playwright.config.ts`; `npm run build && npm run test:dist-smoke`; sandbox: `tools/dev/sandbox.sh up` (with the four fixture variables from AGENTS.md) → `RHYTHM_LIVE_E2E=1 npx playwright test -c tests/issue-1565-live-playwright.config.ts -g sandbox` (a `test.skip` unless `RHYTHM_LIVE_E2E=1`; the unstubbed test hits 4098, with the port and token switch copied from `electron-e14-playwright.config.ts`) → `tools/dev/sandbox.sh down`. If the fixture root is unavailable, record BLOCKED and keep the PR in draft; `detect_changes({scope:'compare', base_ref:'e93eac6e'})` lists only the files in this table; exact output goes in the run log | Last |

**Determinism rules for every S5 test:**
- Each spec pins `timezoneId`/`locale` explicitly.
- Each spec fixes the clock with `openPage`/`openFixture` or `page.clock.setFixedTime`.
- String comparisons normalize `\s`.
- No assertion reads the host clock or zone.
- Screenshots are artifacts, not `toHaveScreenshot` goldens (fonts differ across machines).

## GitNexus impact (index `.mega-wt/integration` @ `788e7ccc`; `git diff 788e7ccc e93eac6e -- apps/web` is empty)

| Symbol | Risk | Direct callers | Slice |
|---|---|---|---|
| `Transcript` | LOW | 1 (`AgentsWorkspace`) | S2 |
| `LiveSchedulesTool` / `LiveReviewTool` / `LiveEmailTool` | LOW each | 1 each | S2 |
| `timeLabel` (messages/live) / `timeLabel` (messages/index) | LOW / LOW | 1 / 1 | S3 (deleted) |
| `dateTimeLabel` (automations, uid `Function:apps/web/src/pages/automations/index.tsx:dateTimeLabel`) | LOW | 2 | S3 |
| `formatDate` (LiveArtifactsShell) | LOW | 1 | S3 (deleted) |
| `LiveFacilitiesPage` / `MobileAccessPage` / `IntegrationsPage` | LOW each | 1 each | S3 |
| `AutoPromotionSettings` | LOW | 1 | S4 |

No HIGH or CRITICAL symbol is touched. No execution flow is affected. There is no gateway, store or api_server edit.

## Coverage matrix (request → slice → falsifier → validation)

| Requirement | Slice | Falsifier | Validation |
|---|---|---|---|
| Inventory of raw sites and ad-hoc formatters (Transcript, Inspector, task cards, session list, reset times) | Plan | Inventory tables R1–R17; "no change" list | G1 scan |
| One dependency-free shared API | S1 | D1 API; zero imports; empty `package.json` diff | S1 commands |
| Concise local time; date+time when needed | S1 | T1–T6, T15 | `node --test` |
| Yesterday only if justified | S1 | D3 rationale; T19 | `node --test` |
| Valid machine-readable `dateTime` | S1–S3 | T1/T13 iso; P1/P4/P7 `datetime` parses | Playwright |
| Full accessible tooltip/text | S1, S5 | P1 title == sr-only; P4 sr-only string; P7 axe | Playwright + axe |
| Zone/locale injection; no flaky tests | S1, S5 | T3, T10, T11, T16, T18; P6; determinism rules | `TZ=…` runs; P6 |
| DST / year / locale / invalid | S1 | T2, T6–T8, T10–T14 | `node --test` |
| Honest "Time unavailable" | S1–S3 | T14; L8 | Playwright |
| No relative ambiguity | S1 | T19 | `node --test` |
| Ownership (#1566 / #1567 / #1582) | Plan | Ownership table; G1 allowlist entry removed by #1567 | Astra review |
| Issue AC: all six raw sites + new finds | S2, S3, S4 | P1, P4, L1–L7, L10 | Playwright |
| Issue AC: four ad-hoc formatters replaced or documented | S3 | `rg` empty for deleted helpers; comments present | `rg` |
| Issue AC: no raw ISO anywhere + a guard | S5 | G1, P7 | `node --test`, Playwright |
| Issue AC: local 12-hour (1:01 PM, not 20:01) | S1, S2 | T1; L1 | tests |
| Issue AC: `Aug 12` gone + live/fixture stated | #1567 | Stated live (#1567 body). #1565 closes only after #1567 merges. | #1567 PR |
| Issue AC: planner UTC pins | S3 | Keep-reason comment at `planner/index.tsx:32` | review |
| Playwright screenshots | S5 | Listed screenshot set exists in `docs/ai/runs/artifacts/issue-1565/` | run log |

## Dependencies

1. S1 first. Its API is frozen above, so #1566, #1567 and #1582 can code against it once S1 merges.
2. S2 and S3 run in parallel; their files are disjoint.
3. S4 waits for #1559.
4. S5 runs last. S0 runs any time after S1 and is non-blocking.
5. #1582 S5 needs #1565 S2 merged (or S1 merged, with #1582 doing the one-line swap).
6. #1567 removes the `Inspector.tsx` G1 allowlist entry.
7. Issue #1565 closes when this PR and #1567 have both merged.

Recommended dispatch: one GPT-6 Sol agent with slices as commits (about 150 changed lines), in a
fresh context carrying only this file plus the #1565 body.

## Open questions (safe defaults applied; none block Astra's review)

1. **Inspector R16/R17** (share expiry, artifact meta). Default: add them to #1567's scope because it
   owns `Inspector.tsx` timestamps; #1565 never edits the file. Fallback: a #1565 follow-up commit
   after #1567 merges.
2. **12-hour clock.** Default: follow the locale (en-US gives 12-hour for all current users).
   Forcing `hour12:true` for non-US locales is a one-option change if AJ wants the #1010 rule
   applied literally everywhere.
3. **Date-only displays** (`Due 2026-09-24`, the tasks `dateLabel`) and `rhythm-workspace-ui` parity.
   Default: out of scope. File a follow-up only if AJ wants it.
4. **"Yesterday"/relative time.** Default: omitted (D3). Reset-time countdowns are #1566's call.
