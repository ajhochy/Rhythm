---
date: 2026-09-19
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: []
status: plan
tags: [plan, Rhythm]
---

# Eliminating the duplicated Rhythm UI

**Status:** plan · **Worktree:** `.mega-wt/ws-ui-port` @ `25c5f4b2` · **Fork:** `hermes-rhythm-plugin` @ `8ea642dbb6` (branch `mega/2026-09-18-rhythm-plugin-finish`)

## 0. What exists today

Two implementations of the same nine workspace screens:

| | `apps/web/src/pages/*` (Electron) | `packages/rhythm-workspace-ui/src` (plugin) |
|---|---|---|
| Screens | 9 pages, 5,521 lines of `index.tsx` + 429+307 lines of `live.tsx` | 9 screens + ScreenRoot, 4,186 lines |
| Styling | global `styles.css` (876 lines) + per-page `.pg-*` sheets | 1,579 lines, every rule scoped under `.rhythm-workspace-root` |
| Transport | `RendererGateway` (34 domains) via `GatewayProvider` | `RhythmDomainGateway` (9 domains) via `RhythmWorkspaceProvider` |
| Auth model | full-trust local+production bearer, loopback-pinned | no credentials; host adapter + receipt-bound operations |
| Consumer | `apps/electron/src/policy.mjs:4` serves `apps/web/dist` | vendored `dist/` → `plugins/rhythm/desktop/src/plugin.tsx:16-38` |

The vendored artifact corresponds to `d676faae` (`desktop/vendor/rhythm-workspace-ui/PROVENANCE.md`), the pre-rebase twin of `de41b85c` on this branch; `a8d37ff0` rebased the same source onto mega. So the vendored dist ≈ current `packages/rhythm-workspace-ui/src`. Confirmed by byte-identical stylesheet sizes (`dist/styles/screens/tasks.css` 26,898 B vs `src/styles/screens/tasks.css` 26,898 B).

---

## 1. Findings on the two open risks

### Risk 1 — Layout/chrome coupling: smaller than feared, but non-zero and concentrated in one file

**The pages do not depend on `Shell`'s DOM.** `Shell.tsx` renders `.app-canvas > .app-header + Splitter + .workspace-surface > main#main-content` (`apps/web/src/components/Shell.tsx:122-181`). No page stylesheet references `.workspace-surface`, `.app-canvas`, `#main-content`, or `--app-navigation-height`. The only shell-ish thing the pages use is `100dvh`/`100vh` in dialog `max-height` clamps (`apps/web/src/pages/tasks/styles.css:109`, `pages/dashboard/styles.css:102`, `pages/planner/styles.css:80`), which are viewport-relative, not container-relative. In a Hermes plugin surface those clamps over-size dialogs slightly; cosmetic, not structural.

**The page stylesheets are already scoped.** A brace-depth scan over every stylesheet:

- `pages/{tasks,planner,projects,rhythms,messages,facilities,automations,integrations}/styles.css` — zero unscoped top-level selectors; every rule nested under `.pg-tasks`, `.pg-planner`, … (163, 130, 206, 132, 135, 201, 167, 155 rules).
- `pages/dashboard/styles.css` — 146 rules, all under `.work-first-dashboard`.
- `components/ListInspector.css` (28 rules), `components/Splitter.css` (8 rules) — not nested, but uniquely prefixed `.list-inspector*` / `.splitter*`; collide with nothing.
- `pages/settings/SettingsPage.css`, `pages/hermes/styles.css`, `pages/dashboard/liveArtifacts.css`, `components/{Profiles,SessionRail,Transcript,ToolWorkspace}.css` — unscoped, but none belong in the plugin.

**The one real problem is `apps/web/src/styles.css`,** global by construction:

- `styles.css:51-64` — `* { box-sizing }`, `html, body, #root { width/height: 100% }`, `html { background: var(--bg) }`, `body { margin:0; overflow:hidden; color; background; font-family: var(--font-ui); font-size: 13px; line-height: 1.5 }`, `::selection`, `* { scrollbar-color }`, `*::-webkit-scrollbar-thumb`, `:where(button,a,select,input,textarea,[tabindex]):focus-visible { outline: 2px solid var(--accent) }`, `button:disabled { opacity: .58 }`.
- `styles.css:1-49` — `:root { --bg … --shadow }` and `:root[data-theme="light"]`.
- `styles.css:66-69` — `.sr-only`, `.skip-link`, `.rotate-180`, `.spin`.

Dropped into the Hermes dashboard document this repaints the host. Hermes's `web/src/index.css` is Tailwind v4 + `@nous-research/ui`, with `html { font-size: var(--theme-base-size) /* 15px */ }` and `body { font-family: var(--theme-font-sans) }` at `web/src/index.css:93-108`. `styles.css`'s `body` rule has equal specificity and wins on injection order — and `build.py` injects into `document.head` at module-eval time (`plugins/rhythm/packaging/build.py:48-56`), after the host's bundled CSS. Global font, base size, background, scrollbars and focus rings across all of Hermes would change. `.rotate-180` and `.sr-only` are also Tailwind utility names.

CSS **variables** collide much less than expected: Hermes defines `--foreground/--midground/--background/--theme-*/--color-*/--radius*` (`web/src/index.css:50-88`) and zero bare `--bg`, `--fg`, `--surface`, `--border`, `--accent`. So `styles.css`'s `:root` block adds rather than clobbers. `--list-inspector-list-width` (`components/ListInspector.css:8`) and `--app-navigation-height` (`styles.css:74`) are set inline by their own components and are safe.

Of the **335 class names defined in `styles.css`**, only **40** are referenced by the nine pages plus shared components (`compact, danger, danger-button, detail-header, dialog-actions, dialog-backdrop, dialog-body, dialog-header, dialog-panel, dialog-wide, error, eyebrow, field, icon-button, menu-item, menu-popover, page-task-action, primary-button, row-actions, search-field, secondary-button, selected, span-2, spin, sr-only, task-editor-*, text-button, text-danger-button, tool-detail, tool-rail, tool-split, tool-state-panel, warning, wide`). The other 295 are agent-workspace/shell chrome the plugin never renders.

That 40-class set is exactly what `packages/rhythm-workspace-ui/src/styles/base.css` already contains — its header says so verbatim: "Shared primitives ported from apps/web/src/styles.css (buttons, dialogs, menus, state panels, the task-editor form) — every unprefixed custom property … renamed to this package's own `--rhythm-*` vocabulary … nested under `.rhythm-workspace-root`" (`styles/base.css:1-5`). 101 lines, 8,794 bytes.

**Verdict:** cheap. The nine page stylesheets need a mechanical re-scope (`.pg-tasks` → `.rhythm-workspace-root .pg-tasks`, `var(--border)` → `var(--rhythm-border)`), and the 40 shared primitives are already ported and scoped. The global reset must never ship to the plugin — it stays in `apps/web`. One hazard remains: `pages/rhythms/index.tsx:73-76` portals its inspector into a `document.querySelector(selector)` target, escaping the scoped root and losing all styling in a plugin surface; that portal must go during the port.

### Risk 2 — Read-only mode and the confirmation flow: the real gap, and it is large

**(a) Capability / read-only mode.** `apps/web`'s `RendererGateway` has no capability concept. Its only mode axis is `GatewayMode = 'fixture' | 'live'` (`apps/web/src/gateway/index.ts:1`). No `capabilit|canWrite|canMutate` anywhere in `pages/`.

`apps/web` does have a per-page `SurfaceState` (`'ready' | 'loading' | 'empty' | 'server-error' | 'forbidden' | 'unavailable' | 'readonly'`, `pages/automations/index.tsx:52`). But in fixture mode it is a demo toggle read from a hash query param (`pages/facilities/index.tsx:25-33`); in live mode it is derived from an HTTP status after a failed load (`pages/automations/index.tsx:339`); it is a whole-page binary banner (`pages/automations/index.tsx:572`, `pages/projects/index.tsx:726`), not a per-operation grant; and there is no way for a host to inject it.

The package gates every individual operation on an affirmative host-supplied grant: a 47-member `RhythmWorkspaceCapability` union (`src/host/types.ts:50-105`) consumed as `const can = (op) => capabilities.includes('projects.write') || capabilities.includes(op)` in `ProjectsScreen.tsx:40-41`, `FacilitiesScreen.tsx:197-201`, `RhythmsScreen.tsx:144-145`, `PlannerScreen.tsx:83-85`, `TasksScreen.tsx:108-110`, `IntegrationsScreen.tsx:66`, `AutomationsScreen.tsx:268`, `DashboardScreen.tsx:65`, `MessagesScreen.tsx:98`. Absence is read-only by default — deliberate, per `host/types.ts:46-48`.

**(b) Two-phase confirmation receipt.** `apps/web` has none. `pages/tasks/index.tsx` calls mutations directly: `gateway.domains.tasks!.update(task.id, { status })` (line 288), `.create(...)` (319), `.delete(...)` (435). Nothing between the click and the write. No `generation` / optimistic-concurrency token anywhere in `apps/web/src/gateway/` (the only `generation` identifiers are React render-race counters in `pages/dashboard/index.tsx:359` and `LiveArtifactsShell.tsx:226`). The nearest analogue — `X-Rhythm-Human-Approval` in `gateway/approvals.ts:62-76`, `gateway/mobile-access.ts:96-100` — is agent-run approval signed by the Electron Keychain, a different mechanism the shared package explicitly forbids (`tests/test-utils/forbiddenScan.ts:18`, needle `approveRun`).

The package's protocol: screen renders a focus-trapped dialog → `host.confirmTaskOperation` / `host.confirmWorkspaceOperation` (`host/types.ts:139-146`) → plugin `POST /tasks/{id}/confirmation` or `POST /workspace-operations/confirmation`, storing the one-use receipt keyed by canonical JSON (`plugin.tsx:107-124, 339-348`) → gateway method replays it on `POST /tasks/{id}/operations` / `POST /workspace-operations`. The backend binds actor, workspace, intent digest, generation, TTL and a pending-count limit to the nonce (`plugins/rhythm/dashboard/plugin_api.py:658-731`), returns `confirmation_already_issued` 409, `confirmation_pending_limit` 429, `stale_confirmation` 409, and does not consume a receipt on mismatch (`plugin_api.py:716-727`).

**Size of the gap.** Adding (a)+(b) to `apps/web`'s nine pages is a per-screen redesign of every mutation path: ~60 call sites need a capability predicate, a confirm dialog, a canonical-JSON payload, a generation token, and conflict/uncertain error handling. The package spent M1–M10 on exactly this (`tests/operations-repairs.contract.test.ts`, `collaboration-review.contract.test.ts`, per-screen contract suites). **This is the real reason the fork built a separate package, and any plan that ignores it is wrong.**

**Two hard constraints, both encoded as tests:**
- `tests/forbidden-imports.test.ts` + `test-utils/forbiddenScan.ts:10-19` ban `from 'electron'`, `window.rhythmShell`, `Bearer `, `createSession`, `launchQuickActionSession`, `agentSession`, `approveRun` from all shared source. `apps/web/src/pages/tasks/index.tsx:118` and `pages/planner/index.tsx:198` destructure `createSession` from `useFixtures()`, and tasks/planner/dashboard import `launchQuickActionSession` (`components/quickActions.ts:35`, which creates a Secretary agent session and opens a socket). **Three of the nine pages violate the shared-package contract on their first line of imports.**
- `plugins/rhythm/contracts/architecture.json` sets `"embed_second_agent_ui_allowed": false` and forbids `renderer_credentials`.

---

## 2. Recommendation

**Converge on one implementation living in `packages/rhythm-workspace-ui`, and invert the dependency: `apps/web` becomes a consumer of the package.** Port the redesign screen-by-screen from `apps/web/src/pages/*` into the package, adding the capability + confirmation seams at port time, deleting both the `apps/web` page and the package's stale screen as each lands. Hoist the genuinely shared primitives (`ListInspector`, `Splitter`, `useSelectedId`, `FocusDialog`, `TaskCreateForm`, `HeaderTaskAction`, `Icon`, the 40 base CSS primitives) into that package first so both sides stop diverging while the port runs.

End state: `apps/web/src/pages/{tasks,planner,rhythms,projects,messages,facilities,automations,integrations,dashboard}` are gone and `App.tsx` renders package screens inside `Shell`.

### Why this direction and not the reverse

1. **All the hard seams already exist in the package and none exist in `apps/web`** — gateway context, host adapter, capability union, confirmation protocol, CSS scoping with `--rhythm-*` mapping, `ScreenRoot`, singleton-React guard, forbidden-import scanner, tsup dual-format build with React external, and a `dist/styles/**` layout `build.py` already consumes. Moving screens into that frame means adding gating to JSX. Moving the frame into `apps/web` means rebuilding all of it and re-deriving packaging from scratch.
2. **`apps/web` can supply the host adapter trivially** — it is the privileged host: tokens mapped from `styles.css`, `viewport: 'expanded'`, all capabilities, no-op confirms. The Electron app loses nothing.
3. **The grain of the existing work already runs this way.** `src/components/FocusDialog.tsx:1-3` is "Ported verbatim … from apps/web/src/components/FocusDialog.tsx"; `styles/base.css:1-5` says the same for the primitives. There is a `SOURCE_MAP.md` convention. What is missing is the deletion half.
4. **It removes the duplication permanently.** Porting the redesign into the package and keeping both is the status quo with fresher pixels — it guarantees a third divergence in six months.

### The honest case against

- **Nine screen rewrites, not nine file moves.** ~5,500 lines of redesigned page JSX, each needing capability predicates and a confirmation path it has never had. 18–27 engineer-days for Phase 3 alone. Re-skinning the package screens is cheaper per-screen and does not touch the Electron app.
- **It puts the Electron app's shipping UI behind a package boundary while #1544 is open.** Every Phase-3 screen changes `apps/web`, the tree #1544 is trying to land.
- **Three pages import agent-session machinery.** Tasks, Planner and Dashboard lose Secretary quick actions unless re-expressed through `onRequestFollowUp` (`host/types.ts:130-136`) — mapped to `host.newChat` in the plugin (`plugin.tsx:277-284`) and `launchQuickActionSession` in `apps/web`. A genuine behavioural seam, not a rename.
- **`apps/web` gains a build-time dependency on a workspace package** — Vite alias + React dedupe, and a package build step before `apps/web` builds. New infrastructure in the Electron release path.

If the Electron redesign is still churning weekly, defer until #1544 merges. Scheduling caveat, not a change of recommendation.

---

## 3. Constraints respected

- **No new runtime dependencies.** Only `lucide-react`, already bundled by tsup `noExternal` (`tsup.config.ts:18`) and license-declared (`plugins/rhythm/LICENSES/LUCIDE-ISC.txt`).
- **React / React DOM stay external peers** — `tsup.config.ts:16`, `peerDependencies: ^18.3.1 || ^19.2.0`, `BUNDLE_EXTERNALS` in `packaging/validate.py:18`, build-graph assertion `build.py:76-79`, `tests/{no-second-react,singleton-react}.test.ts`.
- **No credentials in the plugin renderer.** All traffic on `ctx.rest` (`plugin.tsx:41, 88-98`); `forbiddenScan.ts` bans `Bearer `; `contracts/architecture.json` forbids `renderer_credentials`.
- **`plugin.tsx` keeps working.** It imports 12 value exports + 14 types from `src/index.ts` (`plugin.tsx:16-38`). This plan is additive; the only breaking change is deliberate and staged per screen, gated by `tests/public-api.test.ts`.

---

## 4. Phased plan

### Phase 0 — Land the open PRs, freeze the baseline (0.5 d)

- **Rhythm #1544** (OPEN) contains the entire `apps/web` redesign. Phases 1–3 edit `apps/web/src`. **Blocking prerequisite.**
- **Fork #17** (OPEN) contains packaging, installer, live-gate, theme seam. Phase 4 edits `build.py` inputs and vendor PROVENANCE. **Blocking for Phase 4 only** — Phases 1–3 are Rhythm-only.

Deliverable: a `SOURCE_MAP.md` row per screen recording `apps/web` source path + line range + commit, so each port is auditable.

### Phase 1 — Hoist shared primitives (2–3 d, ships independently)

Move into `packages/rhythm-workspace-ui/src/components/`:
- `ListInspector.tsx` + `useSelectedId` (198 lines) and `ListInspector.css` (28 rules), re-scoped under `.rhythm-workspace-root`, `--border-soft` → `--rhythm-border-soft`. Keep `--list-inspector-list-width` (component-set inline).
- `Splitter.tsx` (260 lines) + `Splitter.css` (8 rules). Its `localStorage` use (`Splitter.tsx:36,59,98-101`) moves behind an injectable store (§5) — in a plugin it otherwise writes bare `layout.*` keys into the host's origin storage, and `resetSplitterSizes()` would sweep host keys sharing that prefix.
- `useWorkspaceMembers.ts` (23 lines), parameterised on the gateway's `members()`.
- `TaskCreateForm.tsx` / `HeaderTaskAction.tsx` — reconcile the two copies, keeping the richer `apps/web` version.

`apps/web` then imports these from the package. Export additively — `plugin.tsx` unaffected.

**Verification:** package `npm run typecheck && npm test` (css-scoping, forbidden-imports, public-api, singleton-react green); `apps/web` existing suites; visual diff of Tasks and Settings, the heaviest `ListInspector` consumers.

### Phase 2 — Make the app-level seams injectable in `apps/web` (2 d, ships independently)

- `navigate` (10 sites) — `Shell.tsx:22-24` is a 3-line hash setter. Replace with a context (§5) whose `apps/web` implementation is the same three lines.
- `useFixtures` (11 sites) — pages use only `notify`, `createSession`, `setUnreadThreads`, `theme/setTheme`. Split: `notify` → `host.notify`; `createSession`/`launchQuickActionSession` → `host.onRequestFollowUp`; `setUnreadThreads` → gateway-derived; `theme` stays in `apps/web`.
- `../../icons` (6 sites) — map `IconName` onto the package's `components/Icon.tsx`; keep `apps/web`'s `icons.tsx` for shell-only glyphs.

**Verification:** `apps/web` suite; grep asserts zero `from '../../components/Shell'` and zero `useFixtures()` inside the nine pages.

### Phase 3 — Port screens one at a time (2–3 d each × 9 = 18–27 d; each ships independently)

Order: **tasks → planner → dashboard → rhythms → projects → messages → facilities → automations → integrations.**

Per screen, one PR:
1. Move page JSX into `src/screens/<X>Screen.tsx`, wrapped in `ScreenRoot`.
2. Move `pages/<x>/styles.css` → `src/styles/screens/<x>.css`; prefix every top-level selector with `.rhythm-workspace-root `; rename every `var(--token)` to `var(--rhythm-token)`. Add the `@import` to `src/styles/rhythm.css` — today it imports only `tasks.css` and `dashboard.css` (`rhythm.css:6-11`) while the other seven screen sheets exist unreferenced; fix that here.
3. Add capability gating: a `can(op)` predicate per mutation control, defaulting closed.
4. Add the confirmation path: focus-trapped dialog → `host.confirmWorkspaceOperation` / `confirmTaskOperation` → gateway method with `generation`. Reference shape: `TasksScreen.tsx:239-250`.
5. Excise forbidden coupling — `createSession`, `launchQuickActionSession`, the `createPortal` in rhythms (`pages/rhythms/index.tsx:73-76`), viewport-relative dialog clamps.
6. Delete the old package screen **and** the `apps/web` page; point `App.tsx` at the package export.
7. Widen `apps/web`'s host adapter with the new screen's capabilities and a no-op confirm.

**Verification per screen:** package contract test updated to the new DOM, asserting both modes — full-capability host renders controls, empty-capability host renders none; `css-scoping` and `forbidden-imports` green; `apps/web` Playwright for that route; a capability-matrix test asserting every mutation control is absent when its grant is absent.

A mixed state is valid: the package exports screens individually and the plugin only sees changes when the vendor artifact is refreshed.

### Phase 4 — Refresh the vendored artifact (1 d, requires fork #17 merged)

- `npm run build` in the package → `dist/`.
- Copy `dist/` + `package.json` verbatim into `plugins/rhythm/desktop/vendor/rhythm-workspace-ui/`.
- Update `desktop/vendor/rhythm-workspace-ui/PROVENANCE.md`: source revision and all five SHA-256 digests (`index.js`, `index.cjs`, `index.d.ts`, `index.js.map`, `index.cjs.map`); it currently pins `d676faae…` / `index.js c93f1375…`.
- Update `plugins/rhythm/PROVENANCE.md`'s "Vendored UI source remains `d676faae…`" line.
- Widen the capability array at `plugin.tsx:322` if new grants were introduced; add any new `workspace-operations` names to `_m5_payload`'s allowlist (`plugin_api.py:231-273`) and `contracts/api-operations.json`.
- **`build.py` needs no change.** `_desktop_entry` rglobs `dist/styles/**/*.css` and strips `@import` lines (`build.py:44-51`), so new screen stylesheets are picked up automatically; `BUNDLE_EXTERNALS` unchanged; `_bind_jsx_to_host_react` (`build.py:82-110`) only needs the bundle to keep emitting `react/jsx-runtime` imports, which tsup's `external` guarantees.

**Verification:** `python -m plugins.rhythm.packaging.build --output <tmp>` must pass `validate_package_tree` (single ESM artifact, no relative chunks, no embedded React, allowed externals only); install via `packaging/install-local.sh`; walk RELEASE-GATE / LIVE-GATE.

### Phase 5 — Remove the duplication receipts (1 d)

Delete the dead `apps/web` page directories, prune the orphaned 295 shell-only classes from `styles.css`, and add a CI guard failing if a file under `apps/web/src/pages/` re-implements a screen the package exports.

---

## 5. Interface design for the injectable seams

All belong on `RhythmHostAdapter` (`src/host/types.ts`), already provided by both hosts. Every field optional so `plugin.tsx` keeps compiling.

```ts
/** In-package route target. The host owns URL shape; screens only name a destination.
 *  Supersedes apps/web/src/components/Shell.tsx:22-24 (`navigate(path)`), whose ten call
 *  sites all pass an app-specific path like `/tasks/task/${id}`. */
export type RhythmDestination =
  | { screen: RhythmScreenId }
  | { screen: 'tasks';      entity: 'task';        id: string }
  | { screen: 'rhythms';    entity: 'rule';        id: string }
  | { screen: 'projects';   entity: 'instance';    id: string }
  | { screen: 'projects';   entity: 'template';    id: string }
  | { screen: 'facilities'; entity: 'reservation'; id: string }
  | { screen: 'messages';   entity: 'thread';      id: string };

export interface RhythmHostAdapter {
  // …existing fields unchanged…

  /** Replaces the free-form `onNavigateToScreen(screenId, { relatedId })`. That signature
   *  stays for one release as a deprecated alias so plugin.tsx:349-352 keeps working. */
  onNavigate?: (destination: RhythmDestination) => void;

  /** Transient, non-blocking status. apps/web maps to useFixtures().notify (store.tsx:268);
   *  the plugin may map to a host toast or drop it. Never used for errors that need a
   *  decision — those surface in-screen. */
  notify?: (message: string, tone?: 'info' | 'success' | 'warning' | 'danger') => void;

  /** Durable, host-owned UI preferences (splitter sizes). Keys are package-namespaced
   *  ("rhythm.layout.tasks.list"). Synchronous by contract; a host with no storage
   *  returns null and the screen falls back to its default. Replaces the direct
   *  window.localStorage access in apps/web/src/components/Splitter.tsx:36,59,98. */
  preferences?: {
    get(key: string): string | null;
    set(key: string, value: string): void;
    /** Clears every key under the package namespace. Must never touch host keys. */
    clear(prefix: string): void;
  };

  /** Read-only observation of which screen the host is showing, when the host owns
   *  routing (the plugin reads `?tab=` at plugin.tsx:296). Screens use it only to avoid
   *  navigating to themselves; they never set it. */
  activeScreen?: RhythmScreenId;
}
```

Deliberately **not** added: anything letting a screen construct a URL, a credential, an agent session, or a raw HTTP request. Quick actions keep routing through `onRequestFollowUp` (`host/types.ts:130-136`) — `apps/web` implements it with `launchQuickActionSession`, the plugin with `host.newChat`; neither literal appears in shared source, satisfying `forbiddenScan.ts:15-16`.

`apps/web` implementation sketch (lives in `apps/web`, not the package):

```ts
const hostAdapter: RhythmHostAdapter = {
  tokens: mapAppThemeToRhythmTokens(theme),   // reads apps/web/src/styles.css :root
  viewport: 'expanded',
  currentUser: { id: String(authUser.id), displayName: authUser.name,
                 initials: initialsOf(authUser.name),
                 collaborationCapability: 'write',
                 capabilities: ALL_RHYTHM_CAPABILITIES },
  onNavigate: (d) => navigate(pathFor(d)),     // the same 3 lines as Shell.tsx:22-24
  notify,
  preferences: { get: k => localStorage.getItem(k),
                 set: (k, v) => localStorage.setItem(k, v),
                 clear: resetSplitterSizes },
  onRequestFollowUp: ctx => void launchQuickActionSession(
    gateway.domains.sessions!, ctx.action as QuickActionPresetId,
    ctx.relatedId ? { id: ctx.relatedId, title: ctx.label } : null),
  // A host that already holds the credential does not need a second confirmation.
  confirmTaskOperation: async () => true,
  confirmWorkspaceOperation: async () => true,
};
```

On the gateway side `apps/web` needs a thin adapter from its 34-domain `RendererGateway` to the package's 9-domain `RhythmDomainGateway` — mostly identity, with shims where types differ (`apps/web` `TaskFixture.notes: string | null` vs package `RhythmTask.notes: string`; collaborator ids `number` vs `string`). `createLiveGateway` cannot be reused by the plugin: `validateLiveBase` (`gateway/index.ts:88-103`) hard-requires `http://127.0.0.1:<port>` and would reject the plugin's `rest()` seam. The plugin keeps building its own `RhythmDomainGateway`.

---

## 6. Packaging

Nothing structural changes. The fork consumes the package as a vendored prebuilt npm `dist/`, and that remains the correct boundary: the Rhythm repo builds, the fork vendors a pinned, hashed artifact.

- **Obtaining the artifact:** the package is already standalone and publishable (`name @ajhochy/rhythm-workspace-ui`, `files: ["dist"]`, `prepublishOnly: npm run build`). Either publish and `npm pack` into the vendor dir, or copy `dist/` + `package.json` from a clean CI build of a tagged Rhythm commit. Prefer the latter while the repos move together — the pin stays a git SHA rather than a semver range.
- **`build.py`:** unchanged (verified above).
- **Vendor `PROVENANCE.md`:** update every refresh with the new source revision, all five SHA-256 digests, and confirmation that transformation remains "none". `package-manifest.json` enforces `provenance.required_fields: ["source","revision","transformation"]`.
- **Licenses:** unchanged.
- **Contracts:** new semantic operations require matching entries in `contracts/api-operations.json` and `plugin_api.py`'s `_m5_payload` validator; `contracts/architecture.json`'s `allowed_proxy_endpoints` is already narrower than the routes in use and should be reconciled in the same PR.

---

## 7. Risks and rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Global `styles.css` leaks into Hermes | `css-scoping.test.ts` fails any top-level selector not under `.rhythm-workspace-root`; `styles.css` never enters the package | Revert vendor dir to the previous artifact + PROVENANCE hashes |
| A ported screen ships a mutation control with no capability gate | Per-screen capability-matrix test: render with `capabilities: []`, assert zero enabled mutation controls | Per-screen revert; screens export individually |
| A ported screen reintroduces agent-session coupling | `forbidden-imports.test.ts` fails on the literals | Build-time, cannot ship |
| Second React instance from hoisted primitives | `no-second-react.test.ts`, `singleton-react.test.ts`, `build.py:76-79` graph assertion | Build-time |
| `plugin.tsx` breaks on a changed export | `public-api.test.ts` snapshots the surface; keep deprecated aliases one release | Pin the vendor artifact to the prior SHA |
| `apps/web` regresses while #1544 is in review | Phase 0 gates on #1544 merging first | — |
| #1544 merges with further redesign after a screen is ported | Port order front-loads the screens least likely to change; re-port cost is one PR | — |

**What would make me abandon this recommendation mid-flight:**

1. **The first screen (Tasks) takes more than ~4 days.** Tasks is the best case — smallest gap, package screen already implements the confirmation flow, shapes closest. If Tasks costs 4+ days the other eight cost 40+, and the honest move is to stop, keep two implementations, and invest in a visual-parity checklist so they drift slowly rather than freely.
2. **The redesign depends on live-only Electron surfaces.** `pages/dashboard/LiveArtifactsShell.tsx` runs an iframe capability broker with a nonce'd CSP handshake (`LiveArtifactsShell.tsx:246-284`). If Dashboard's redesign cannot be separated from that broker, Dashboard stays in `apps/web` and the package keeps its own `DashboardScreen` — a permanent documented exception, not a reason to abandon the other eight.
3. **Hermes's host CSS requires more than class scoping.** If Tailwind v4's `@theme inline` or preflight reaches inside `.rhythm-workspace-root` in ways scoping cannot defend (it should not — preflight is element-level and the package already overrides at `base.css:17-30`), the answer is an iframe or shadow root for the plugin surface, a different project that would make this port not worth doing.
4. **#1544 does not merge.** Everything here edits the tree that PR owns.

---

## 8. Effort estimate

| Phase | Estimate | Ships alone |
|---|---|---|
| 0 — land PRs, freeze baseline, SOURCE_MAP | 0.5 d (+ external wait on #1544/#17) | n/a |
| 1 — hoist shared primitives | 2–3 d | yes |
| 2 — injectable seams in `apps/web` | 2 d | yes |
| 3 — nine screen ports | 2–3 d each → **18–27 d** | yes, per screen |
| 4 — vendor refresh + provenance + gates | 1 d | yes (after #17) |
| 5 — delete duplication, add CI guard | 1 d | yes |
| **Total** | **24.5–34.5 d** | |

**If only half the time existed (~13 d):** Phases 0, 1, 2, then port **only Tasks, Planner and Dashboard** (the plugin's default tab is `overview`/Dashboard, `plugin.tsx:297`), then Phase 4. Leave the other six on the package's existing screens. `plugin.tsx:374` dispatches per tab, so a half-ported package is a valid shipping state — three screens converge, six stay duplicated with a dated `SOURCE_MAP.md` entry saying so.

**Cut first inside a screen port:** the `.pg-*` → `.rhythm-workspace-root .pg-*` re-scope can be done by a build step rather than hand-editing 1,400 rules, if hand-editing proves to be the bulk of the per-screen cost. **Never cut:** the capability gate and the confirmation path. A screen ported without them is a write-enabled Rhythm UI inside a host that was told it had none — the one failure mode this architecture exists to prevent.

---

### Critical files for implementation

- `packages/rhythm-workspace-ui/src/host/types.ts`
- `packages/rhythm-workspace-ui/src/index.ts`
- `apps/web/src/styles.css`
- `apps/web/src/components/Shell.tsx`
- `hermes-rhythm-plugin/plugins/rhythm/desktop/src/plugin.tsx`
