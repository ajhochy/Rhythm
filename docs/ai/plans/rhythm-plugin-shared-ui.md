---
date: 2026-09-19
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: []
status: plan
tags: [plan, Rhythm]
---

# Rendering `apps/web` inside the Hermes Rhythm plugin

**Status:** plan (rewrite of `dce64ab5`) · **Worktree:** `.mega-wt/ws-ui-port` @ `25c5f4b2` · **Fork:** `hermes-rhythm-plugin` @ `8ea642dbb6` (branch `mega/2026-09-18-rhythm-plugin-finish`)

## 0. Why this replaces `dce64ab5`

`dce64ab5` assumed the plugin is a low-trust guest and therefore costed a per-screen
redesign: a capability predicate and a two-phase confirmation dialog at each of ~60
mutation call sites in `apps/web`. That was 18–27 days of Phase 3 alone, 24.5–34.5 total.

The owner owns and trusts both surfaces. Capability gating and click-path confirmation
dialogs are his policy, not a constraint. So the direction inverts: **the plugin renders
`apps/web`'s pages directly**, supplied with (a) a gateway object over `ctx.rest`, (b) a
host shim, (c) no gating. `packages/rhythm-workspace-ui` is then redundant and retires.

**The new number is 14–19 engineer-days.** Down from 24.5–34.5, but still weeks, not days.
§8 says exactly which part refused to shrink and why, and §9 says which old phases vanished.

---

## 1. The two things that stay locked

### 1.1 The agent tool path — verified already separate; the job is to *keep* it separate

`plugins/rhythm/tools.py` exposes `rhythm_get_dashboard`, `rhythm_list_tasks`,
`rhythm_complete_task` to the model. Verified with file:line:

- `tools.py:50` declares its **own** receipt store, `_completion_receipts: dict[str, _CompletionReceipt]`,
  guarded by its own `_receipt_lock` (`tools.py:32`), with its own dataclass (`tools.py:35-47`)
  and its own 30-second TTL (`tools.py:31`).
- `plugin_api.py:89` and `plugin_api.py:94` declare the **UI** stores, `_task_confirmations`
  and `_workspace_confirmations`, guarded by `_oauth_lock`, TTL 60 s (`plugin_api.py:91`).
- `tools.py` never calls `/tasks/{id}/confirmation` or `/tasks/{id}/operations`. It goes
  straight to `RhythmClient.mutate_task` (`tools.py:185`, `backend/client.py:213`).
- The ACP gate is `tools.py:145-153` (`get_edit_approval_requester`, deliberately a deferred
  import so the path is fail-closed when ACP is absent), `tools.py:156-175`
  (`_approval_proposal`), `tools.py:211-215` (no requester → `acp_approval_required`),
  `tools.py:234-237` (deny/timeout → `acp_approval_denied`), and the 13-clause revalidation
  at `tools.py:241-258`.

**Answer to "do the UI click path and the agent tool path share receipt code?" — No.**
They share exactly five read-projection helpers, imported at `tools.py:21-27`:
`_dashboard_summary`, `_safe_identity`, `_safe_workspace`, `_task`, `_task_authorized`
(defined at `plugin_api.py:459, 362, 381, 403, 352`), plus `RhythmClient.mutate_task`.
None of them is receipt machinery; all five are pure projection/authorization predicates.

But the *coupling direction is wrong*: `tools.py` imports private names out of the module
that this plan is about to widen heavily (§5). A careless edit to `_task_authorized` while
adding a route weakens the agent gate silently. So the first phase is a freeze, not a split.

**A second finding that changes the security story and must be stated plainly.** The UI
confirmation flow is *not* a human-in-the-loop gate today. `plugin.tsx:328-336` implements
`confirmTaskOperation`/`confirmWorkspaceOperation` by POSTing straight to the confirmation
endpoint and returning `true`. No dialog, no prompt, no user. The focus-trapped dialog lives
inside the vendored package's screens; the host mints the receipt unconditionally. Anything
already executing in the Hermes renderer can complete a task right now. The receipt
machinery in `plugin_api.py:658-731` is therefore an **idempotency / single-flight /
stale-generation** mechanism — genuinely valuable (`intent.claimed` at `plugin_api.py:723`
is what stops a repeat PATCH across a retry), but not an authorization boundary against the
renderer. The boundary that *is* held against a prompt-injected model is ACP in `tools.py`,
and it is independent code.

**Untouched by every phase of this plan:**

| Artifact | Why |
|---|---|
| `plugins/rhythm/tools.py` — all 298 lines | The ACP gate. Not edited, not refactored, not reformatted. |
| `RhythmClient.mutate_task` (`backend/client.py:213-240`) | Shared by the agent path; its "409 is authoritative, ambiguity is never upgraded to success" contract (`client.py:228-238`) is load-bearing for the agent. |
| `POST /tasks/{task_id}/confirmation` (`plugin_api.py:658`) and `POST /tasks/{task_id}/operations` (`plugin_api.py:694`) | Keep the receipt+intent-lease path for `complete`/`reschedule` exactly as-is. These are the two operations the model can also perform; they keep the strong path. |
| `store.approval_scope()` and the `(profile, generation)` tuple it returns | The agent's re-validation anchor (`tools.py:209, 240`). |

### 1.2 No credentials in the plugin renderer

All plugin traffic stays on `ctx.rest` (`plugin.tsx:41`, wrapped at `plugin.tsx:87-98`).
`tests/test-utils/forbiddenScan.ts:14` bans the literal `Bearer `;
`contracts/architecture.json` forbids `renderer_credentials`.

**How `apps/web` screens get data without importing the live gateway.** `RendererGateway`
(`apps/web/src/gateway/index.ts:45-54`) is a plain interface: `mode`, `environment`,
`domains`, `health`, `unsupported`. `domains` (`index.ts:4-38`) is a record of optional
per-domain objects. The plugin constructs that object literal itself with `mode: 'live'`
and hands it to `GatewayProvider` (`gateway/context.tsx:6`). It never calls
`createLiveGateway` (`index.ts:120`) and never touches `validateLiveBase`
(`index.ts:81-96`), which would reject a non-loopback base anyway.

**The real hazard, and it is concrete.** The nine pages import *values* — not just types —
from the per-domain gateway modules, and those modules contain the bearer construction in
the same file:

```
pages/tasks/index.tsx:10        import { TaskGatewayError, … } from '../../gateway/tasks'
pages/planner/index.tsx:9       import { PlannerGatewayError, … } from '../../gateway/planner'
pages/dashboard/index.tsx:10    import { DashboardGatewayError, … } from '../../gateway/dashboard'
pages/rhythms/index.tsx:13      … gateway/rhythms   (Bearer at rhythms.ts:36)
pages/dashboard/index.tsx        … gateway/dashboard (Bearer at dashboard.ts:38)
```
plus `projects`, `messages`, `facilities`, `automations`, `integrations`, `live-artifacts`,
`user-preferences`, `mobile-access` — 20 of the 34 gateway modules contain `Bearer `.

Importing `RhythmsGatewayError` pulls `createLiveRhythmsGateway` and its
`Authorization: Bearer ${token}` header into the plugin bundle.

**Fix, and the thing that stops a future edit reintroducing it:** split each of the ten
domain modules the nine pages touch into `<domain>.types.ts` (interface + `*GatewayError`
class + DTO types) and `<domain>.live.ts` (the `createLive*` / `createFixture*` factory,
the only file containing `Bearer `). Pages import from `.types`. Then:

1. A **source guard** in `apps/web`: `tests/plugin-surface.spec.ts` walks the import graph
   from a new `src/plugin-surface.ts` barrel and fails if any reachable module contains a
   `FORBIDDEN_TERMS` needle. Same needle list as `forbiddenScan.ts`, copied with a comment
   naming the fork file so the two stay legible together.
2. An **artifact guard** in the fork: the existing `validate_package_tree` already scans the
   built bundle; add `Bearer ` to the rejected-source regex in
   `packaging/validate.py:_validate_bundle_source` (currently checks source maps, env refs,
   dev JSX, embedded React). That is the guard that cannot be argued with — it runs on the
   shipped bytes.

Guard 2 is the one that matters. Guard 1 just makes the failure fast and local.

---

## 2. Findings: can `apps/web`'s pages render unmodified?

Nine pages, 7,423 lines of `.tsx`: tasks 631, planner 871, dashboard 1,492 (incl.
`LiveArtifactsShell.tsx`), rhythms 439, projects 771, messages 726 (incl. `live.tsx`),
facilities 1,131 (incl. `live.tsx`), automations 633, integrations 729.

Everything imported from outside the page directories, counted across all nine:

```
 12 '../../gateway/context'      useGateway            → plugin provides GatewayProvider
 12 '../../components/FocusDialog'                     → portable, zero app coupling
 10 '../../store'                useFixtures           → the real seam (§2.2)
  9 '../../components/Shell'     navigate              → the easy seam (§2.1)
  7 '../../components/ListInspector'                   → portable
  6 '../../icons'                Icon                  → portable (lucide-react)
  5 '../../components/useWorkspaceMembers'             → portable
  4 '../../gateway/auth'         useAuthUser           → plugin provides AuthUserProvider
  3 '../../components/quickActions'                    → the agent-session seam (§2.3)
  3 '../../components/TaskCreateForm'                  → portable
  3 '../../components/Splitter'                        → portable, but writes localStorage
  3 '../../components/HeaderTaskAction'                → portable
 14 '../../gateway/<domain>'     types + error classes → §1.2 split
```

That is the whole surface. `react-dom` appears once (`pages/rhythms/index.tsx:2`). No page
imports `@xterm/xterm`, `marked`, or `qrcode.react` — those are confined to
`components/Inspector.tsx`, `Transcript.tsx`, `ToolWorkspace.tsx`, none of which the pages
reach. So the plugin's new runtime dependency set is `lucide-react`, which the fork already
vendors and license-declares (`plugins/rhythm/LICENSES/LUCIDE-ISC.txt`).

### 2.1 `navigate` — 9 import sites, 34 call sites, and it needs no React at all

`Shell.tsx:21-23` is three lines: `window.location.hash = path.startsWith('/') ? path : '/'+path`.
Call sites: dashboard 15, messages 4, planner 3, automations 3, projects 2, tasks 2,
rhythms 1, facilities 1, integrations 1 = 32 in-page (plus 2 in helper components).

Do **not** convert this to a React context — that is 34 call-site edits for nothing. Move
the function to `apps/web/src/nav.ts` with a swappable implementation:

```ts
// apps/web/src/nav.ts
let impl: (path: string) => void = (path) => {
  window.location.hash = path.startsWith('/') ? path : `/${path}`;
};
export function navigate(path: string): void { impl(path); }
/** A host that owns routing installs its own. Returns the previous impl so a
 *  host can restore it; `apps/web` never calls this. */
export function setNavigationSink(sink: (path: string) => void): (path: string) => void {
  const previous = impl; impl = sink; return previous;
}
```

Nine import lines change from `'../../components/Shell'` to `'../../nav'`; `Shell.tsx`
re-exports `navigate` from `nav.ts` so nothing else in `apps/web` moves. The plugin calls
`setNavigationSink` once, mapping `/tasks` → `#/rhythm?tab=tasks` via the fork's existing
`rhythmRouteTarget` (`desktop/src/route-state.ts`, used at `plugin.tsx:342`).

Cost: ~1 hour. The prior investigation's "10 sites, 3 lines" undercounted call sites but
reached the right conclusion for the wrong reason.

### 2.2 `useFixtures` — the seam that is *not* cheap, because the store is not portable

`store.tsx` is 1,148 lines. Its context value (`store.tsx:1142`) has ~90 members. The nine
pages use **five** of them:

```
notify              tasks:118  planner:198,522  rhythms:181  projects:123
                    messages:99  facilities:172  automations:270  integrations:140  dashboard:84,319
createSession       tasks:118  planner:198
setUnreadThreads    messages:99
liveMessageThreads / setLiveMessageThreads / liveMessagesLoading / liveMessagesError
                    messages/live.tsx:85-89
```

Mounting `FixtureProvider` in the plugin is not an option. Its imports (`store.tsx:1-14`)
pull `gateway/sessions` (WebSocket agent-session runtime), `security/humanApprovalSigner`
(`signApprovalDecision`), `agentSessionLink`, `gateway/approvals` — i.e. `agentSession`,
`createSession` and `approveRun`, three of the eight forbidden needles, plus a bearer. It
also reads/writes seven `window.localStorage` keys (`store.tsx:126-177, 214-218, 315, 350`)
into whatever origin it finds itself in — in Hermes, the host's.

So: extract a small context, `apps/web/src/workspaceHost.tsx`, with exactly what the pages
need. `FixtureProvider` renders it (implementing `notify` with its existing `setToast` at
`store.tsx:268`, `newChat` with `createSession`); the plugin renders it with its own four
implementations. The nine pages swap `useFixtures()` → `useWorkspaceHost()` — 11
destructure sites. `liveMessageThreads` is lifted state that only exists because Shell's nav
badge needs the unread count (`store.tsx:278, 291-292`); in the plugin it is just state
inside the provider.

Cost: ~0.75 d. Signature in §6.

### 2.3 Quick actions → `host.newChat`

`components/quickActions.ts:35` creates a Secretary agent session and opens a socket. Three
pages call `launchQuickActionSession`: `tasks/index.tsx:469`, `planner/index.tsx:742`,
`dashboard/index.tsx:424`; two also call `createSession` directly
(`tasks/index.tsx:484`, `planner/index.tsx:356`), each followed by `navigate('/agents')`.

**Decision: injected seam, not absence.** These are the highest-value affordance on the
three screens and `plugin.tsx` already has the right target — `askHermes`, wired to
`onRequestFollowUp` at `plugin.tsx:338`. Put a single `newChat` on the workspace-host
context (§6). `apps/web` implements it with `launchQuickActionSession` + `navigate('/agents')`;
the plugin implements it with `askHermes`. The literals `createSession`,
`launchQuickActionSession` and `agentSession` then appear only in
`apps/web/src/components/quickActions.ts` and `store.tsx`, neither of which is reachable
from the plugin barrel — which the §1.2 guard proves rather than asserts.

Cost: ~0.5 d, including deleting the now-dead direct `createSession` branches in
tasks/planner (`tasks/index.tsx:480-488`, `planner/index.tsx:352-359` — these are the
fixture-mode arms of the same affordance).

### 2.4 `styles.css` — 43 classes of 335, and no build-time re-scoping needed

Loaded once at `main.tsx:8`. 876 lines. Its global reset (`styles.css:51-64`) would repaint
Hermes: `body { margin:0; overflow:hidden; font-family: var(--font-ui); font-size:13px }`
has equal specificity to Hermes's `web/src/index.css:93-108` and wins on injection order,
because `build.py:52-56` appends the pack's `<style>` to `document.head` at module eval,
after the host's bundled CSS.

Measured, not estimated: of the 335 class names defined in `styles.css`, the nine pages plus
the five shared components reference **43**:

```
compact danger danger-button detail-header dialog-actions dialog-backdrop dialog-body
dialog-header dialog-panel dialog-wide error eyebrow field icon-button menu-item
menu-popover message page-task-action primary-button row-actions search-field
secondary-button selected span-2 spin splitter sr-only task-editor-error
task-editor-field task-editor-footer task-editor-form task-editor-pair
task-editor-section task-editor-section-head text-button text-danger-button tool-detail
tool-rail tool-split tool-state-panel user warning wide
```

The nine page stylesheets need **no work at all**. A brace-depth scan over
`pages/{tasks,planner,dashboard,rhythms,projects,messages,facilities,automations,integrations}/styles.css`
(157/127/139/127/198/130/197/163/150 top-level selectors) finds zero selectors outside
`.pg-*` / `.work-first-dashboard` / `.rhythms-*`. Each page imports its own sheet
(`pages/tasks/index.tsx:25` and eight siblings), so they arrive with the module graph.

**How the plugin gets the 43 without the reset:** one hand-written file,
`apps/web/src/plugin-base.css`, ~130 lines — the 43 rules copied verbatim from `styles.css`
with a `.rhythm-workspace-root ` prefix, preceded by one block turning `styles.css:1-49`'s
`:root { --bg … --shadow }` into `.rhythm-workspace-root { --bg … --shadow; font-family: var(--font-ui); font-size: 13px; line-height: 1.5; color: var(--fg) }`.
Custom properties inherit into the subtree, so the pages' `var(--border)` etc. resolve with
no renaming — and Hermes defines zero bare `--bg`/`--fg`/`--surface`/`--border`/`--accent`
(`web/src/index.css:50-88` is all `--foreground`/`--theme-*`/`--color-*`), so nothing
collides in either direction.

No PostCSS, no prefix plugin, no 1,400-rule mechanical edit. Guard against drift: a test
that hashes the 43 rule bodies extracted from `styles.css` and fails when they change
without `plugin-base.css` changing. ~40 lines of test.

Cost: ~1 d including the drift test.

### 2.5 Two risks from `dce64ab5` that do not exist

- **`pages/rhythms/index.tsx:73-76` does not escape the scoped root.** `InspectorPortal`
  portals to `document.querySelector("[data-testid='rhythm-detail']")` — its single call
  site, `rhythms/index.tsx:433`, targets an element rendered by the *same page*, inside
  `.rhythm-workspace-root`. It escapes the React tree, not the DOM subtree. Styling is
  unaffected. No change needed.
- **`LiveArtifactsShell.tsx` is not part of Dashboard.** Grepped: its only importer is
  `apps/web/src/App.tsx`, not `pages/dashboard/index.tsx`. The iframe capability broker with
  the nonce'd CSP handshake (`LiveArtifactsShell.tsx:240-290`) is an App-level surface, and
  the plugin already ships its own `ArtifactsScreen` (`plugin.tsx:374`). **Dashboard is
  fully portable.** The artifacts broker stays an `apps/web`-only surface — a documented
  exception covering one file, not a screen.

---

## 3. Recommendation

**Render `apps/web`'s nine pages in the plugin. Retire `packages/rhythm-workspace-ui`
wholesale.**

The plugin builds a `RendererGateway`-shaped object over `ctx.rest`, mounts
`GatewayProvider` + `AuthUserProvider` + the new `WorkspaceHostProvider` inside
`.rhythm-workspace-root`, and dispatches per `?tab=`. No capability array, no confirmation
dialogs, no per-screen port.

Retire the package rather than keep it: `apps/web` covers all nine screens plus Artifacts
(which the plugin also has), so nothing is left for it to own, and keeping a second
implementation "just for the plugin" is precisely the divergence this exercise exists to
end. Its useful residue is small and specific — `styles/base.css`'s proof that 101 lines of
primitives is enough (informs §2.4), and its per-screen contract tests, which should be
re-pointed at the `apps/web` DOM during P6 rather than deleted.

### The honest case against

1. **The transport is the whole job, and it is ~100 methods.** The pages call across ten
   domains: 24 distinct methods on `projects` alone (`gateway/projects.ts:19-41`), 9 on
   `rhythms`, 9 on `planner`, 7 on `tasks`, plus facilities, messages, automations,
   integrations, dashboard, user-preferences. The plugin backend today exposes ~20 read
   routes and 35 semantic write operations (`_m5_payload`'s schema table,
   `plugin_api.py:237-269`) — and covers **no** collaborator management, no task
   create/delete, no arbitrary task field update, no `generateInstance`, no
   `deleteInstance`, no `updateInstanceGoal`, no milestone update/delete, no automations
   mutations, no integrations OAuth/settings/sync. Trust does not conjure HTTP endpoints.
2. **It ties the plugin's UI to `apps/web`'s churn.** Today the plugin pins a hashed
   artifact and is immune to `apps/web` edits until someone re-vendors. After this it is
   still a pinned artifact, but the thing being pinned is the tree PR #1544 is actively
   reshaping.
3. **`apps/web` has no library build target.** It is a Vite SPA (`vite.config.ts`, 11
   lines). A second build config plus an export barrel is new release-path infrastructure
   in the Rhythm repo (§7).
4. **`CLAUDE.md` says `apps/web` is a prototype and the Flutter app is the shipping
   client.** This plan makes `apps/web` load-bearing for the Hermes plugin. That is a
   deliberate promotion; if the intent is still that `apps/web` dies when Flutter catches
   up, this is the wrong direction and the answer is to keep the package.
5. **The bundle grows.** `icons.tsx:1` does `import * as Icons from 'lucide-react'` — a
   namespace import. The static `iconSet` object (`icons.tsx:5-62`, ~55 icons) should shake
   to those 55, but namespace imports defeat some bundlers' shaking. Measure the artifact in
   P3; if it exceeds the current vendored `dist/index.js` by more than ~2×, convert
   `icons.tsx` to named imports (a 55-line mechanical edit).

---

## 4. Interface design

Three seams, all in `apps/web`. Every one is additive; `apps/web` keeps working unchanged.

```ts
// apps/web/src/nav.ts — see §2.1
export function navigate(path: string): void;
export function setNavigationSink(sink: (path: string) => void): (path: string) => void;
```

```ts
// apps/web/src/workspaceHost.tsx
// Everything the nine pages need from outside their own directory, other than the
// gateway and the auth user. Deliberately five members: adding a sixth means a page
// grew an app-level dependency, and that should be visible in review.

export interface WorkspaceHost {
  /** Transient toast. apps/web: FixtureProvider's setToast (store.tsx:268).
   *  Plugin: a host toast, or a no-op. Never used for errors needing a decision. */
  notify(message: string): void;

  /** Hand this work to an agent and focus the conversation.
   *  apps/web: launchQuickActionSession(…) then navigate('/agents')
   *            (tasks/index.tsx:469, planner/index.tsx:742, dashboard/index.tsx:424).
   *  Plugin:   askHermes(…) (plugin.tsx:338 — host.newChat).
   *  Returns when the chat exists; screens do not await a reply. */
  newChat(request: {
    action: string;                       // QuickActionPresetId, or a free-form label
    label: string;
    subject?: { id: string; title: string } | null;
  }): Promise<void>;

  /** Cross-screen unread badge. Messages publishes; Shell (apps/web) consumes.
   *  The plugin's implementation may drop it. */
  unreadThreads: number;
  setUnreadThreads(count: number): void;

  /** Thread list lifted out of pages/messages/live.tsx:85-89. It lives here rather
   *  than in the page only because the badge above is derived from it. */
  messageThreads: {
    items: MessageThread[];
    setItems: React.Dispatch<React.SetStateAction<MessageThread[]>>;
    loading: boolean;
    error: string;
  };
}

export function WorkspaceHostProvider(props: { value: WorkspaceHost; children: React.ReactNode }): JSX.Element;
export function useWorkspaceHost(): WorkspaceHost;
```

```ts
// apps/web/src/plugin-surface.ts — the export barrel the fork vendors.
// This file's transitive import graph is what tests/plugin-surface.spec.ts scans.
import './plugin-base.css';                       // §2.4 — never src/styles.css

export { DashboardPage } from './pages/dashboard';
export { TasksPage } from './pages/tasks';
export { PlannerPage } from './pages/planner';
export { RhythmsPage } from './pages/rhythms';
export { ProjectsPage } from './pages/projects';
export { MessagesPage } from './pages/messages';
export { FacilitiesPage } from './pages/facilities';
export { AutomationsPage } from './pages/automations';
export { IntegrationsPage } from './pages/integrations';

export { GatewayProvider } from './gateway/context';
export { AuthUserProvider } from './gateway/auth';
export { WorkspaceHostProvider, type WorkspaceHost } from './workspaceHost';
export { setNavigationSink } from './nav';

export type { RendererGateway, GatewayDomainContracts } from './gateway';
// …the ten <domain>.types re-exports (§1.2). No createLive* factory is exported,
// and none is reachable: that is what the guard asserts.
```

The plugin's side, in `plugins/rhythm/desktop/src/plugin.tsx`:

```ts
function createRendererGateway(rest: Rest): RendererGateway {
  const get  = <T,>(path: string) => read<T>(rest, path);
  const post = <T,>(path: string, body: unknown) => write<T>(rest, path, body);
  return {
    mode: 'live',
    environment: null,          // no ports exist on this side; pages read it only for the receipt chip
    health: { api: async () => ({ service: 'api', state: 'healthy' }),
              engine: async () => ({ service: 'engine', state: 'healthy' }) },
    unsupported: (op) => Promise.reject(new RhythmGatewayError('unavailable', op)),
    domains: {
      tasks:    createRestTasksGateway(get, post),
      rhythms:  createRestRhythmsGateway(get, post),
      // …one per domain the nine pages use. Each is a thin mapping onto §5's routes.
    },
  };
}
```

Not added, deliberately: any way for a page to construct a URL, a credential, an agent
session, or a raw `fetch`. `RendererGateway.environment` is `null` in the plugin — the
`EnvironmentReceipt` component (`gateway/context.tsx:20`) is an `apps/web` chrome element
the plugin never mounts.

---

## 5. The transport, and the one place laziness pays

`apps/web` writes by PATCHing the Rhythm API with a bearer. The plugin must not. So every
write needs a server-side route in `plugin_api.py`.

The existing pattern is `_m5_payload` (`plugin_api.py:231-340`): a per-operation schema with
per-field validators, plus a readback path (`_m5_readback_path:752`), an authorization path
(`_m5_authorization_path:770`), a canonical-result check (`_canonical_m5_result:738`) and an
entry in `contracts/api-operations.json`. Extending it to cover ~40 more operations is
5–7 days of schema writing and tests.

**Take the cheaper rung.** Add one bounded write proxy alongside — not replacing — the
existing paths:

```
POST /workspace-write   { method, resource, id?, sub?, subId?, body? }
```

- `resource` ∈ a fixed enum mapped to upstream path templates
  (`tasks → /tasks`, `recurring-rules`, `project-templates`, `project-instances`,
  `facilities`, `message-threads`, `automation-rules`, `users`). `sub` ∈
  `{collaborators, steps, messages, reservations, milestones, instances}`. Ids must pass the
  existing `_safe_id` (`plugin_api.py:348`). The upstream path is *constructed* from the
  enum, never taken from the request — no traversal surface.
- `method` ∈ `{POST, PATCH, DELETE}`.
- `body` is forwarded as-is after structural caps only: ≤ 32 KB serialized, ≤ 4 levels deep,
  ≤ 64 keys per object, no non-JSON scalars. Field semantics are validated by the upstream
  Rhythm API — which is the same authority `apps/web` already relies on, and the only one
  that can validate them correctly.
- Rate-limited and single-flighted by `(resource, id, sub, subId, method)` for 2 s, reusing
  the `_oauth_lock` + pruning pattern already in the module.

**What this deliberately gives up, stated plainly.** Per-field rejection before the request
exists, canonical readback reconciliation, and the non-repeat-PATCH intent lease. Those
matter most for the two operations a prompt-injected model can also reach, so
`complete`/`reschedule` do **not** move: the tasks page keeps calling
`/tasks/{id}/confirmation` + `/tasks/{id}/operations` for status changes. Everything else —
titles, notes, collaborators, templates, reservations, rules — is human-driven UI where a
duplicate PATCH is a cosmetic bug, not a safety event.

**What it does not give up.** The credential stays server-side. The renderer still cannot
name a host, a port, or a token. And it does not widen who can call it: as established in
§1.1, anything in the Hermes renderer can already drive the 35 allowlisted operations with
no human in the loop, because `plugin.tsx:328` mints receipts automatically.

Two contract files must move with it, in the same PR:
- `contracts/architecture.json` lists five `allowed_proxy_endpoints` while `plugin_api.py`
  already serves ~30 routes, and grepping the fork finds **no code reading that key** —
  `contracts/validate.py` does not enforce it. It is stale documentation. Either make it
  enforced and accurate, or delete the key. Do not leave a third state.
- `"forbidden": ["arbitrary_proxying"]` in the same file is a claim this route must be
  measured against. The enum-constructed path is what makes it bounded rather than
  arbitrary; say so in the contract, in one sentence, next to the entry.

---

## 6. Phased plan

### P0 — Freeze the agent path (1.5 d · ships independently)

- New `plugins/rhythm/dashboard/projections.py`: move `_task`, `_task_authorized`,
  `_safe_identity`, `_safe_workspace`, `_dashboard_summary` (currently `plugin_api.py:403,
  352, 362, 381, 459`) into it. `plugin_api.py` and `tools.py:21-27` both import from there.
  Pure move, no behaviour change.
- `tests/test_agent_path_isolation.py`: assert `tools.py` imports nothing from
  `plugin_api`; assert `tools._completion_receipts` and `plugin_api._task_confirmations` are
  distinct objects; assert a filled `_task_confirmations` does not let `rhythm_complete_task`
  proceed without ACP; assert `rhythm_complete_task` still returns `acp_approval_required`
  when the requester is absent and `acp_approval_denied` when it returns falsy.
- Pin `tools.py` by SHA-256 in the repo's contract tests, so any later phase touching it
  fails loudly rather than quietly.

**Verification:** existing fork Python suite + the new test. **Ships independently: yes** —
this is a strict improvement whether or not the rest lands. **Touches fork #17: no**
(new files + one import move).

### P1 — `apps/web` seams (2 d · ships independently)

`nav.ts` (§2.1) · `workspaceHost.tsx` + 11 destructure sites (§2.2) · `newChat` replacing
the five quick-action/`createSession` sites (§2.3) · ten `<domain>.types.ts` / `.live.ts`
splits (§1.2) · `plugin-base.css` + drift test (§2.4) · `plugin-surface.ts` barrel +
`tests/plugin-surface.spec.ts`.

**Verification:** `npm run typecheck`; full Playwright suite (`apps/web` `npm test`) —
these are refactors with no intended behaviour change, so a green existing suite *is* the
proof; `plugin-surface.spec.ts` green; the CSS drift test green.
**Ships independently: yes.** **Touches PR #1544: heavily — this is the blocking
interaction** (§10).

### P2 — Plugin host shim (1.5 d · does not ship alone)

In the fork: mount `GatewayProvider` + `AuthUserProvider` + `WorkspaceHostProvider` inside
the existing `.rhythm-workspace-root` (`plugin.tsx:352`), call `setNavigationSink` with
`rhythmRouteTarget`, implement `WorkspaceHost` (`notify` → host toast, `newChat` →
`askHermes`, unread → local state). Dispatch `?tab=` to the nine `apps/web` pages instead of
the package screens. `AuthUserProvider` needs an `AuthUser` — derive `id`/`name`/`email`
from `GET /auth/me`, which `plugin_api.py` already reaches via `_safe_identity`; add a
`GET /identity` read route returning only those three fields.

**Verification:** the plugin renders against a running backend with reads only. All writes
fail closed until P4.

### P3 — Library build + vendoring (2 d · does not ship alone)

See §7. **Verification:** `python -m plugins.rhythm.packaging.build --output <tmp>` passes
`validate_package_tree`; artifact size compared against today's vendored `dist/index.js`.

### P4 — The bounded write proxy (2–3 d · ships independently within the fork)

`POST /workspace-write` per §5, its caps, its single-flight, its tests (traversal attempts,
oversize body, depth bomb, unknown resource, unknown sub, duplicate within the window), plus
the `contracts/architecture.json` reconciliation.

**Verification:** new Python tests; the existing `/tasks/{id}/operations` suite must be
untouched and green — that is the regression signal that P4 did not leak into the strong
path.

### P5 — Domain gateway adapters (4–7 d · ships per domain)

One `createRest<Domain>Gateway` per domain, mapping `apps/web`'s method names onto reads
(existing GET routes) and writes (`/workspace-write`, except tasks status → the receipt
path). Order by payoff: **dashboard → tasks → rhythms → planner → messages → projects →
facilities → automations → integrations.** Dashboard and tasks are read-heavy and prove the
shape; projects (24 methods) and integrations (OAuth, settings, sync) are the long tail.

Per domain, one PR; the `?tab=` dispatcher can point some tabs at `apps/web` pages and
others at package screens during the transition, so a half-done state ships.

**Verification per domain:** the `apps/web` Playwright spec for that route, re-run against
the plugin host via the fork's existing external-host harness; plus the package's retired
contract test for that screen, re-pointed at the new DOM.

### P6 — Retire `packages/rhythm-workspace-ui` (1 d · ships last)

Delete the package. Re-point its nine screen contract tests at the `apps/web` DOM (they
encode real expectations and are the cheapest regression net available). Drop the
package-specific tests that no longer describe anything: `singleton-react`,
`no-second-react` and the artifact guards **stay** — they describe the packaging, not the
package. Remove the vendored `rhythm-workspace-ui` tree and its PROVENANCE, replaced by
P3's.

---

## 7. Packaging

`build.py:_desktop_entry` (`build.py:29-59`) expects exactly two things from the vendored
artifact: a single ESM file at `desktop/vendor/<name>/dist/index.js`, and a `dist/styles/`
tree it rglobs and concatenates. It then re-bundles with `bun build --minify`, externalizing
`BUNDLE_EXTERNALS` (`validate.py:18`), asserts no React in the build graph
(`build.py:76-79`), and rewrites `react/jsx-runtime` imports onto the host React singleton
(`build.py:82-110`).

So `apps/web` must produce that exact shape. Add `apps/web/vite.lib.config.ts`:

```ts
export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: 'src/plugin-surface.ts', formats: ['es'], fileName: () => 'index.js' },
    outDir: 'dist-lib',
    minify: false,                                  // build.py's bun pass minifies
    cssCodeSplit: false,
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
      output: { inlineDynamicImports: true, assetFileNames: 'styles/[name][extname]' },
    },
  },
});
```

**What adding a library build costs, concretely:**

- One config file, one barrel, one npm script (`build:lib`). Half a day.
- `assetFileNames: 'styles/[name][extname]'` puts the single emitted sheet at
  `dist-lib/styles/plugin-surface.css`, which `build.py`'s rglob picks up unchanged. No
  `build.py` edit required. Verify this rather than assume it — if Vite names it
  `style.css` at the root instead, `build.py:44-47` needs a two-word path change.
- **The real risk is `validate.py:_validate_bundle_source`'s heuristics**
  (`validate.py:27-36`). It rejects a bundle matching
  `\b(?:const|let|var)\s+React\s*=` or `function\s+createElement\s*\(`. Vite's React plugin
  with the automatic runtime should emit neither, and bun's minifier renames locals — but
  this is the single most likely P3 failure. Budget half a day for it; the fix, if it hits,
  is to tighten the regex to word-boundary-anchored forms, not to loosen the gate.
- React dedupe: `external` plus `build.py:76-79`'s graph assertion plus
  `validate.py`'s embedded-React scan already cover it three ways. Nothing new.
- Unchanged: licenses (lucide only, already declared), `BUNDLE_EXTERNALS`,
  `_bind_jsx_to_host_react`, `package-manifest.json`'s `desktop.entry`.
- **Provenance:** the vendor dir becomes `desktop/vendor/rhythm-web-surface/` with a new
  `PROVENANCE.md`. Today's file pins five digests (`index.js`, `index.cjs`, `index.d.ts`,
  and two maps) because tsup emits dual-format with maps. A Vite ESM-only lib build emits
  **two** files: `index.js` and `styles/plugin-surface.css`. Pin both, plus the Rhythm git
  SHA and `transformation: none`. `package-manifest.json`'s
  `provenance.required_fields: ["source","revision","transformation"]` is satisfied.
  Fewer digests is not a weakening — it is fewer artifacts.
- Cross-repo flow is unchanged: Rhythm builds, the fork vendors a pinned hashed artifact,
  the pin is a git SHA not a semver range.

---

## 8. Effort, and the part that refused to shrink

| Phase | Estimate | Ships alone |
|---|---|---|
| P0 — freeze the agent path | 1.5 d | yes |
| P1 — `apps/web` seams | 2 d | yes |
| P2 — plugin host shim | 1.5 d | no |
| P3 — library build + vendoring | 2 d | no |
| P4 — bounded write proxy | 2–3 d | yes (fork-internal) |
| P5 — domain gateway adapters | 4–7 d | yes, per domain |
| P6 — retire the package | 1 d | no |
| **Total** | **14–19 d** | |

**This is still weeks, not days, and the reason is the transport.**

Removing capability gating and confirmation dialogs deleted 18–27 days of UI work. It
deleted nothing from the wire. `apps/web` reaches the Rhythm API directly with a bearer
across ~100 gateway methods on ten domains; the plugin's renderer may not hold a credential,
so every one of those methods needs a plugin-backend route and a client method. That
constraint is §1.2 — the one thing explicitly *not* relaxed — and it is the entire
residual cost. P4 + P5 are 6–10 of the 14–19 days, and they are pure plumbing between two
things that already work.

The bounded write proxy (§5) is what keeps it at 6–10 days instead of 12–16: writing 40 more
`_m5_payload` schemas by hand, each with a readback path, an authorization path, a
capability name and a contracts entry, is where a "trusted, so it must be cheap" plan would
quietly go back over three weeks.

**If only half the time exists (~8 d):** P0, P1, P3, P2, then P5 for **dashboard, tasks and
rhythms only** — dashboard because `plugin.tsx:279` defaults to the `overview` tab, tasks
and rhythms because they are the smallest write surfaces. Skip P4 entirely and route those
three domains' few writes through the existing receipt path plus the `rhythms.*` operations
already in `_m5_payload:241-245`. Leave the other six tabs on the package screens; P6 slips.
A mixed dispatcher is a valid shipping state — `plugin.tsx:374` already dispatches per tab.

**Cut first:** the CSS drift test in P1 (re-add when someone actually edits `styles.css`);
`newChat` in P2 — the plugin can render those three screens without quick actions for one
release. **Never cut:** P0, and §1.2's artifact-level `Bearer ` guard in
`validate.py`. P0 is the whole reason this plan is allowed to relax anything.

---

## 9. What vanished from `dce64ab5`

| Old phase | Fate |
|---|---|
| Phase 1 — hoist `ListInspector`, `Splitter`, `FocusDialog`, `TaskCreateForm`, `HeaderTaskAction`, `useWorkspaceMembers` into the package (2–3 d) | **Gone.** The pages travel with their own components; nothing needs hoisting anywhere. |
| Phase 3 — nine screen ports at 2–3 d each (18–27 d) | **Gone.** No screen is ported. Replaced by P5's per-domain adapters (4–7 d), which touch no JSX. |
| Phase 3 step 2 — re-scope 1,400 CSS rules `.pg-*` → `.rhythm-workspace-root .pg-*` and rename every token to `--rhythm-*` | **Gone.** The page sheets are already scoped; custom properties inherit, so no renaming is needed (§2.4). Replaced by one ~130-line file. |
| Phase 3 step 3 — per-screen `can(op)` capability predicates | **Gone.** Policy switched off. |
| Phase 3 step 4 — per-screen focus-trapped confirmation dialogs at ~60 mutation sites | **Gone.** It was never a human gate anyway (§1.1). |
| Phase 3 step 5 — excise the rhythms `createPortal` | **Gone.** It does not escape the scoped root (§2.5). |
| Risk "Dashboard may be unportable because of `LiveArtifactsShell`" | **Gone.** Not a Dashboard dependency (§2.5). |
| Phase 5 — prune 295 orphaned classes from `styles.css` | **Gone.** `styles.css` stays whole in `apps/web`; the plugin simply never loads it. |
| §5's `RhythmDestination` / `preferences` / `activeScreen` host additions | **Gone.** The package they belonged to is being retired. `navigate` needs no type at all (§2.1). |
| Phase 0 SOURCE_MAP.md per screen | **Gone.** There is one source now; provenance is a git SHA in one PROVENANCE file. |
| Phase 4 vendor refresh | **Kept, relocated** into P3, with a different artifact shape (§7). |
| "Never cut the capability gate and the confirmation path" | **Reversed**, on the owner's policy — and replaced by "never cut P0 and the artifact-level bearer guard". |

**New, absent from `dce64ab5`:** P0 (the agent-path freeze), the `<domain>.types` / `.live`
split (§1.2 — `dce64ab5` did not notice that pages import values from bearer-bearing
modules), P4 (the write proxy — `dce64ab5` never costed the backend route surface at all),
and §7's library build.

---

## 10. Risks, rollback, and open PRs

| Risk | Mitigation | Rollback |
|---|---|---|
| A page import drags a bearer into the plugin bundle | `validate.py:_validate_bundle_source` rejects `Bearer ` in the shipped artifact; `plugin-surface.spec.ts` fails earlier and locally | Build-time; cannot ship |
| A P4/P5 edit weakens the ACP gate | P0's isolation test + SHA pin on `tools.py`; `/tasks/{id}/operations` suite must stay green through P4 | Revert the phase; `tools.py` is never edited so it cannot regress |
| `apps/web`'s global reset reaches Hermes | Only `plugin-base.css` is in the barrel's graph; `src/styles.css` is imported solely by `main.tsx:8`, which the barrel does not reach | Revert the vendor artifact |
| The write proxy becomes an arbitrary proxy | Upstream path built from a closed enum, never from the request; body caps; single-flight; contract entry naming the boundary | Delete the route; P5 domains fall back to read-only |
| `validate.py`'s React heuristics reject the Vite bundle | Budgeted in P3; fix by tightening the regex, never by loosening the gate | P3 does not ship |
| `apps/web` churn breaks the plugin | The plugin pins a git SHA; a refresh is a deliberate act | Re-pin to the previous SHA |
| Bundle size regression from `import * as Icons` | Measure in P3; convert `icons.tsx` to named imports if >2× | Cosmetic |

**Rhythm #1544 (open).** Contains the `apps/web` redesign. P1 edits nine page files plus
`store.tsx`, `Shell.tsx` and ten gateway modules — the exact tree #1544 owns. **P1 must land
after #1544 merges,** or it will conflict on every file. P0, P3's fork half, and P4 are
independent of it. If #1544 stalls, start with P0 and P4: both are fork-only, both are
useful regardless of whether this plan ever completes.

**Fork #17 (open).** Contains packaging, installer, live-gate and theme seam. P3 changes
the vendor directory name, its PROVENANCE, and possibly `build.py:44-47`. **P3 is blocked on
#17.** P0 and P4 touch `tools.py`-adjacent and `plugin_api.py` files, not packaging, so they
can proceed in parallel — but confirm #17's diff does not also touch `plugin_api.py` before
starting P4.

Re-check both PRs' status before scheduling; the open/open state above is inherited from
`dce64ab5` and is a week old.

**What would make me abandon this recommendation mid-flight:**

1. **P5's first two domains (dashboard, tasks) take more than 3 days combined.** They are
   the easy ones. If they cost 3+ days, the remaining seven cost 12+, and the honest move is
   to stop after them, keep the package for the other seven tabs permanently, and accept a
   documented two-implementation split with a visual-parity checklist.
2. **`apps/web` is confirmed to be on a path to deletion** in favour of the Flutter client
   (`CLAUDE.md` calls it a prototype). Then it is the wrong base and the package should stay.
3. **The bounded write proxy is rejected on review.** Then P4+P5 return to ~12–16 days and
   the total goes back over four weeks, at which point re-skinning the package's nine
   existing screens is the cheaper answer.

---

### Critical files for implementation

- `/Users/ajhochhalter/Documents/hermes-rhythm-plugin/plugins/rhythm/dashboard/plugin_api.py`
- `/Users/ajhochhalter/Documents/hermes-rhythm-plugin/plugins/rhythm/desktop/src/plugin.tsx`
- `/Users/ajhochhalter/Documents/Rhythm/apps/web/src/store.tsx`
- `/Users/ajhochhalter/Documents/Rhythm/apps/web/src/gateway/index.ts`
- `/Users/ajhochhalter/Documents/Rhythm/apps/web/src/styles.css`
