# Dayflow desktop builder hooks

This implementation intentionally leaves `apps/electron/src/main.mjs`,
`apps/electron/src/preload.cjs`, web desktop declaration files, `SessionRail.tsx`,
and `ToolWorkspace.tsx` untouched. The owning builder should apply the following
small hooks after reviewing its current host authorization composition.

## Main-process composition

Import `createDayflowDesktopHost` and `registerDayflowDesktopIpc` from
`./dayflow-desktop.mjs`. Compose trusted candidates in the main process only:

```js
const installedAppPath = await trustedDiscoverExistingDayflowAt(
  path.join(os.homedir(), 'Applications', 'Dayflow.app'),
); // undefined unless that actual user-local app exists

const dayflowDesktopHost = createDayflowDesktopHost({
  candidates: {
    installedAppPath,
    bundledAppPath: path.join(process.resourcesPath, 'dayflow-desktop', 'Dayflow.app'),
    arch: process.arch,
  },
  execute: run,
});
registerDayflowDesktopIpc({
  ipcMain,
  isTrustedSender: (event) => isAuthorizedRendererEvent(event),
  host: dayflowDesktopHost,
});
```

Do not pass a generic `/Applications/Dayflow.app` candidate. Trusted discovery
may supply only the actual `~/Applications/Dayflow.app` when it exists; otherwise
pass `undefined` and allow the bundled candidate. Do not accept candidates,
paths, URLs, commands, architecture, or environment values from the renderer.
Do not use `open -n`, add installation/autostart, or add
timeline/provider/privacy/capture deep links. The helper revalidates the
artifact before opening it and prefers a verified installed app. A supplied
installed candidate that fails validation must not fall through to bundled.

## Preload bridge

Expose only these no-argument methods, backed by the exact channel constants:

```js
dayflowDesktop: Object.freeze({
  getDayflowDesktopStatus: () => ipcRenderer.invoke('dayflow-desktop:get-status'),
  openDayflowDesktop: () => ipcRenderer.invoke('dayflow-desktop:open'),
}),
```

The main handler requires the existing `isAuthorizedRendererEvent` callback and
an empty payload. Do not expose Dayflow filesystem paths, logs, code-signing
data, certificates, launch options, capture state, provider state, or secrets.

## Renderer hooks

Extend the existing builder-owned `rhythmShell` declaration with the two
methods above. Import `DayflowTool` into the builder-owned `ToolWorkspace.tsx`
and add only the `dayflow` route mapping. Add the existing settings destination
link where that builder owns the surface. Do not create a second Dayflow UI,
embed native content, or claim that native controls render inside Rhythm.

## Tool count

`apps/mcp_server/src/index.ts` now registers two additional MCP tools:
`rhythm_search_dayflow_activity` and `rhythm_recent_dayflow_summaries`.
They use the local `RHYTHM_AGENT_URL`, exact signed-call envelope, and API-side
managed-evidence admission. They remain unavailable until the coordinator binds
the authoritative endpoint; this change does not add a server or alter scopes.
