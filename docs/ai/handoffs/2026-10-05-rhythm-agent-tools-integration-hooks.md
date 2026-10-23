---
date: 2026-10-05
repo: Rhythm
status: pending-builder-integration
tags: [handoff, rhythm, agent-tools, open-design]
---

# Rhythm Agent Tools / OpenDesign integration hooks

This is the only shared-owner handoff for the scoped Agent Tools slice. No shared owner file, package script, configuration, security receipt, Dayflow file, plugin directory, setting, project data, or service was changed. Every snippet is the exact intended code; line numbers refer to the R15 export as read on 2026-10-05. Nothing here removes an existing tab, More entry, route, or test ID.

## Route map

| Tool | Descriptor route | Rendered by | Default pin |
| --- | --- | --- | --- |
| Hermes | `/hermes` | existing `HermesPage` (App.tsx:69) | true (existing tab, `nav-hermes`) |
| Bot Crossing | `/colony` | existing `ColonyPage` (App.tsx:70) | true (existing tab, `nav-colony`) |
| OpenDesign | `/open-design` | new `OpenDesignPage` | true |
| Dayflow | `/tools/dayflow` | frozen Dayflow owner's named export `DayflowTool`, mounted by the builder in ToolWorkspace (owner packet) | **false** |
| Catalog | `/tools/agent-tools` (`AGENT_TOOLS_CATALOG_ROUTE`) | `AgentToolsCatalog` at ToolWorkspace slug `agent-tools` | n/a |

The permanent coordinator is not a descriptor, cannot be pinned (pin writes reject unknown IDs), and stays where it is today.

Dayflow comes from the frozen owner packet (`task-4/orchestration/builder-handoff.md`, accepted by the parent). That packet defines the host `createDayflowDesktopHost` / `registerDayflowDesktopIpc`, the bridge `rhythmShell.dayflowDesktop.getDayflowDesktopStatus()` / `openDayflowDesktop()` with statuses `ready { version, build, identifier }` or `unavailable | unsupported { code }`, and the `DayflowTool` mount from `./tools/DayflowTool`. That source is not in this R15 export. This slice does not edit, reimplement, or replace any of it; it only describes `/tools/dayflow` and checks the bridge's presence in `agentTools/hosts.ts`.

## 1. main.mjs

Imports, beside line 22:

```js
import { registerOpenDesignView } from './open-design-view.mjs';
import { createAgentToolAdapterRegistry, registerAgentToolAdapter } from './rhythm-agent-tools.mjs';
```

Directly after line 86 (`const hermesView = registerHermesView(...)`):

```js
// Closed registry: only the four known tool IDs, each registered once. The
// existing owners are registered as-is; nothing is recreated.
const agentToolAdapters = createAgentToolAdapterRegistry();
registerAgentToolAdapter(agentToolAdapters, 'hermes', hermesView);
const openDesignView = registerAgentToolAdapter(agentToolAdapters, 'open-design', registerOpenDesignView({
  ipcMain,
  getWindow: () => mainWindow,
  // Evaluated per IPC call, after these bindings are initialised. This is in
  // addition to the view's own exact main-frame/route ownership check.
  isTrustedSender: (event) => ownsDocument(event) && !accountsBlocked && accountsAuth.getSnapshot().authenticated,
}));
```

Directly after `colonyHost = registerColonyHost({...});` (line 1044):

```js
registerAgentToolAdapter(agentToolAdapters, 'bot-crossing', colonyHost);
```

Where the builder applies the frozen Dayflow hook, register the host object that hook already creates. Do not create a second one:

```js
registerAgentToolAdapter(agentToolAdapters, 'dayflow', dayflowDesktopHost); // the object returned by the frozen createDayflowDesktopHost(...) call
```

Profile/identity reset (line 348): add the following to the existing `Promise.all([...])`, next to `hermesView.disposeCurrent()`. It closes the view and its ephemeral partition and keeps the IPC handlers, so the next attach builds a fresh view.

```js
openDesignView.disposeCurrent(),
```

Quit (line 1010): add the following to the `stopRuntimes` `Promise.all([...])`, next to `hermesView.dispose()`. It also removes all four IPC handlers, in `finally`.

```js
openDesignView.dispose(),
```

Teardown conceals the view, removes it from the window, and drops host listeners immediately. If the guest's `close()` fails, its request, permission, and navigation denials stay installed until that guest emits `destroyed`, so permissions are never broadened on a guest that is still alive. Neither call starts, stops, signals, or configures the OpenDesign service, and neither kills a process. A full host-document navigation and the loss of the host renderer already call `disposeCurrent` internally.

## 2. preload.cjs: private nonce, epoch, stale-completion protection

Insert this after the `colonyView` block (around line 160). `apps/electron/test/open-design-preload-hook.test.mjs` extracts and executes this exact block, so keep the markers.

<!-- preload-hook:start -->
```js
// The attachment nonce stays inside this closure. The renderer gets only
// { ok: true } or { ok: false, reason? } and never supplies a nonce, URL,
// origin, path, or PID.
let openDesignViewEpoch = 0;
/** @type {string | undefined} */
let openDesignViewAttachment;
const openDesignView = Object.freeze({
  getStatus: () => ipcRenderer.invoke('open-design:status'),
  attach: async () => {
    const epoch = ++openDesignViewEpoch;
    openDesignViewAttachment = undefined;
    let result;
    try { result = await ipcRenderer.invoke('open-design:view:attach'); } catch { result = undefined; }
    // Discard a stale completion WITHOUT detaching: main may have handed the
    // same cached nonce to the newer attach. Main route/document guards
    // suspend or revoke the view on their own.
    if (epoch !== openDesignViewEpoch) return { ok: false, reason: 'detached' };
    const attachment = result?.ok === true && typeof result.attachment === 'string' && result.attachment ? result.attachment : undefined;
    openDesignViewAttachment = attachment;
    return attachment ? { ok: true } : { ok: false, ...(typeof result?.reason === 'string' ? { reason: result.reason } : {}) };
  },
  /** @param {{x: number, y: number, width: number, height: number}} bounds */
  setBounds: (bounds) => openDesignViewAttachment
    ? ipcRenderer.invoke('open-design:view:bounds', { attachment: openDesignViewAttachment, bounds })
    : Promise.resolve(false),
  detach: () => {
    ++openDesignViewEpoch;
    const attachment = openDesignViewAttachment;
    openDesignViewAttachment = undefined;
    return attachment ? ipcRenderer.invoke('open-design:view:detach', { attachment }) : Promise.resolve(false);
  },
});
```
<!-- preload-hook:end -->

In the exposed `rhythmShell` object, add `openDesignView,` directly after `colonyView,` (line 240). Preload reruns on every full document load, so the epoch and nonce reset along with the document. In main, detach only suspends the view (zero bounds); re-attaching from the same document and runtime returns the same view without reloading it.

## 3. App.tsx

Import, beside lines 10–11:

```tsx
import { OpenDesignPage } from './pages/open-design';
```

Before line 73 (`else if (route.startsWith('/tools/'))`):

```tsx
else if (route === '/open-design') content = <OpenDesignPage />;
```

Do not put OpenDesign in an iframe. The page's empty host rectangle is where main places the native `WebContentsView`. `/tools/dayflow` and `/tools/agent-tools` already route to `ToolWorkspace` through line 73.

## 4. Shell.tsx: owner-scoped pins, descriptor routes, native reserves

Imports:

```tsx
import { AGENT_TOOL_DESCRIPTORS, type AgentToolDescriptor } from '../agentTools/registry';
import { readAgentToolPins, subscribeAgentToolPins } from '../agentTools/pins';
import { availableAgentToolIds } from '../agentTools/hosts';
import { useAuthUser } from '../gateway/auth';
```

Line 19: replace the `optional` set. Pinned tool shortcuts join Hermes and Bot Crossing in the existing tier-1 More list.

```tsx
const optional = new Set(['Facilities', 'Automations', 'Integrations', 'Settings', 'Hermes', 'Bot Crossing', 'OpenDesign', 'Dayflow']);
const toolByLabel = new Map<string, AgentToolDescriptor>(AGENT_TOOL_DESCRIPTORS.map((tool) => [tool.label, tool]));
// Keeps the existing nav-hermes / nav-colony test IDs.
const toolNavKey = (tool: AgentToolDescriptor) => tool.id === 'bot-crossing' ? 'colony' : tool.id;
```

Line 98: replace `const visibleDestinations = ...` with the following. `auth.user.id` is the same owner identity `SettingsPage` uses for `readLocalUserPreferences`.

```tsx
const pinScope = useAuthUser()?.user.id;
const [pins, setPins] = useState(() => readAgentToolPins(pinScope));
useEffect(() => {
  const refresh = () => setPins(readAgentToolPins(pinScope));
  refresh();
  return subscribeAgentToolPins(pinScope, refresh);
}, [pinScope]);
const pinnedIds = (pins.scope === pinScope ? pins : readAgentToolPins(pinScope)).ids;
const hostIds = availableAgentToolIds();
// Default pins reproduce today's Hermes/Bot Crossing tabs exactly. An explicit
// unpin hides only that shortcut; the tool stays reachable from the catalog.
const visibleDestinations = [...destinations, ...AGENT_TOOL_DESCRIPTORS.filter((tool) => hostIds.includes(tool.id) && pinnedIds.includes(tool.id)).map((tool) => tool.label)];
```

Lines 208–216: replace `destinationButton` so every tool shortcut navigates to its `descriptor.route`.

```tsx
const destinationButton = (destination: string, inMenu = false) => {
  const tool = toolByLabel.get(destination);
  const key = tool ? toolNavKey(tool) : destinationKey(destination);
  const selected = tool ? route === tool.route : key === activeKey && !visibleDestinations.some((item) => toolByLabel.get(item)?.route === route);
  return (
    <button key={destination} type="button" role={inMenu ? 'menuitem' : undefined} className={inMenu ? 'menu-item' : `destination ${optional.has(destination) ? 'nav-optional' : ''} ${!['Dashboard', 'Agents'].includes(destination) ? 'nav-compact' : ''} ${selected ? 'selected' : ''}`} aria-current={selected ? 'page' : undefined} onClick={() => navigate(tool ? tool.route : `/${key}`)} data-testid={`nav-${key}${inMenu ? '-overflow' : ''}`}>
      {destination}{destination === 'Messages' && unreadThreads > 0 && <span className="unread-badge" aria-label={`${unreadThreads} unread`}>{unreadThreads}</span>}
    </button>
  );
};
```

Line 225 (the More menu) stays unchanged: it already derives its entries from `visibleDestinations` and `optional`.

Line 200, native reserves:

```tsx
const nativeRoute = route === '/hermes' || route === '/colony' || route === '/open-design';
```

This puts OpenDesign under the existing `native-overlay-route` menu/toast reserves (styles.css:135–141). OpenDesign's bounds go to zero only for:

- an explicit blocking modal (`[role="dialog"][aria-modal="true"]` or `[data-native-blocking-modal="true"]`);
- page unmount;
- an inactive hash tab.

Nonmodal menus and toasts use the reserves. If pin storage is unavailable, the pins fall back to the defaults (`error: true`). No existing `rhythm.settings.*` key is ever rewritten.

## 5. SessionRail.tsx: additive catalog entry

Append to the `tools` array (lines 15–28). Every existing entry stays.

```tsx
{ key: 'agent-tools', label: 'Agent Tools', description: 'Hermes, OpenDesign, and more', icon: 'spark' },
```

The existing `openTool(key)` (line 478) navigates to `/tools/agent-tools`. It does not call Electron and grants no host permission.

## 6. ToolWorkspace.tsx: catalog slug, plus the frozen Dayflow mount

Imports:

```tsx
import { AgentToolsCatalog } from './tools/AgentToolsCatalog';
import { availableAgentToolIds } from '../agentTools/hosts';
import { useAuthUser } from '../gateway/auth';
import { navigate } from './Shell';
```

In `ToolWorkspace` (line 1803), before `const tools`:

```tsx
const pinScope = useAuthUser()?.user.id;
```

Add this entry to the `tools` record (line 1806). The `dayflow: <DayflowTool />` entry and its `import { DayflowTool } from './tools/DayflowTool';` come verbatim from the frozen Dayflow owner packet, not from this slice.

```tsx
'agent-tools': <AgentToolsCatalog scope={pinScope} availableIds={availableAgentToolIds()} onOpen={(tool) => navigate(tool.route)} />,
```

The catalog and Shell share one owner scope, so a pin change in the catalog updates the Shell tabs through `subscribeAgentToolPins`.

## 7. Security receipt, package support files, test registration

`apps/electron/src/security-smoke-receipt.mjs`:

```js
// BRIDGE_KEYS: insert 'openDesignView' directly after 'colonyView'.
export const OPEN_DESIGN_VIEW_KEYS = Object.freeze(['getStatus', 'attach', 'setBounds', 'detach']);
// keys checks (beside line 54-55):
[['bridge', 'openDesignView', 'keys'], OPEN_DESIGN_VIEW_KEYS],
// frozen checks (beside line 75-76):
['bridge', 'openDesignView', 'frozen'],
```

The `main.mjs` smoke probe (beside line 1361):

```js
openDesignView: {
  keys: Object.keys(window.rhythmShell?.openDesignView || {}),
  frozen: Object.isFrozen(window.rhythmShell?.openDesignView),
},
```

The receipt's closed allowlists:

- **Host IPC:** `open-design:view:attach`, `open-design:view:bounds`, `open-design:view:detach`, `open-design:status`.
- **Main-frame route:** exactly `rhythm://app/index.html#/open-design`. Add `#/tools/open-design` only if the builder opts into the `toolAliasRoute` alias.
- **Guest network:** only the verified literal `http://127.0.0.1:<port>` origin (compared as a normalised `URL.origin`) and the matching `ws://127.0.0.1:<port>`, from the owned guest renderer only.
- **Guest navigation:** main-frame, subframe, and redirect navigations are allowed only as same-origin HTTP. Same-origin HTTP redirects are allowed; foreign, HTTPS, `ws:`, and `file:` targets are denied.
- **Guest capabilities:** no preload, no Node integration, no webview tag, and no permissions, downloads, or popups.

Package files: if packaged Electron sources are copied selectively, add `rhythm-agent-tools.mjs`, `rhythm-agent-tools.d.mts`, `open-design-runtime.mjs`, and `open-design-view.mjs`. This export has no selective copy list. Never package OpenDesign's installed app, runtime identity files, configuration, credentials, logs, project content, or plugin files.

Test registration: append these files to the `apps/electron/package.json` `test` script:

```
test/rhythm-agent-tools.test.mjs test/open-design-runtime.test.mjs test/open-design-view.test.mjs test/open-design-preload-hook.test.mjs
```

Then add the web pin contract (`node --test src/agentTools/pins.test.mjs`) to the web test chain the builder already uses for `.test.mjs` files.

## 8. Builder-owned manual combined smoke and rollback

These are the `AT-MAN-*` gates in the contract. Run them only after the builder's route/package smoke is authorized, against an OpenDesign service that is already running:

1. `/open-design` attaches.
2. An inactive tab zeroes the bounds; returning resumes without a reload.
3. A blocking modal hides the view; menus and toasts use the reserves.
4. A missing service shows the fixed copy and Retry.
5. Signed-out or blocked accounts are refused through `isTrustedSender`.
6. Profile reset uses `disposeCurrent`, and app quit uses `dispose`.
7. Hostile route, IPC, and navigation attempts fail closed.

Plugin replacement waits until all of those pass. Until then, leave both existing plugin directories and all OpenDesign data untouched. Rollback is simply omitting these hooks: no plugin disable/remove, no service termination, no data restore.
