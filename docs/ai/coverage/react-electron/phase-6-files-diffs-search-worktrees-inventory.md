# Phase 6 capability inventory — files, diffs, search, and worktrees

Date: 2026-08-15  
Flutter reference: `origin/main` at `9fa2761ed78159f83f56982c03fcd85dc035039a`  
Contract provenance root: `361ccc2895a8effd31b51222ec4d7ecf5611ecd9a6e76f0463b41573659a870d`

Flutter citations below are from `git show origin/main:<path>`. React, API, and fork citations are from this checkout as observed on 2026-08-15. This compares executable capabilities, not test declarations or endpoint-map/display strings.

## Missing in React/Electron

These are capabilities the shipping Flutter client has and the React/Electron client cannot perform against the live boundary today.

1. **Select real local files and send their real bytes or safe file reference to a live agent.** Flutter opens a native multi-file picker, resolves MIME from extension/name/magic bytes/UTF-8, inlines text up to 100 KiB, sends images/PDFs as `data:` FileParts, keeps other binaries as `file:` FileParts, and removes pending chips before send (`origin/main@9fa2761:apps/desktop_flutter/lib/features/agents/views/agents_view.dart:2306-2414,2535-2572`; `origin/main@9fa2761:apps/desktop_flutter/lib/features/agents/views/_attachment_mime.dart:19-131,178-222`). React offers five hard-coded `fileFixtures`, fabricates metadata and a fixture `file:///workspace/rhythm/...` URL, and never reads a selected file (`apps/web/src/components/Composer.tsx:9-16,70-102,166`). More importantly, `sendLiveInput` receives attachments but sends only `data: trimmed`; no `parts` cross the live WebSocket (`apps/web/src/store.tsx:278-303`). No React live implementation found.

2. **Search the selected session's real server-side files from `@`, then attach the selected worktree-scoped content.** Flutter debounces the query, calls server-side `find-files` with the local session ID, supports keyboard selection, fetches the selected relative path through the session content proxy, and classifies the returned content into the same canonical attachment parts (`origin/main@9fa2761:apps/desktop_flutter/lib/features/agents/views/_at_mention_popover.dart:1-16,28-52,87-138,145-177`; `origin/main@9fa2761:apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart:890-906`; `origin/main@9fa2761:apps/desktop_flutter/lib/features/agents/views/agents_view.dart:2416-2487`). React filters the same hard-coded five-item array in memory; selection calls `addFixture`, not a gateway (`apps/web/src/components/Composer.tsx:61-66,110-114,153-156`). `SessionGateway` has no find/content operation (`apps/web/src/gateway/sessions.ts:20-31`). No React live implementation found.

3. **Browse, search, refresh, and preview the live session/worktree filesystem with git status.** Flutter's Files tab calls live list plus status, navigates directories using relative paths, fetches content, and renders text, image, or a binary stub (`origin/main@9fa2761:apps/desktop_flutter/lib/features/agents/views/_files_tab.dart:1-9,30-76,110-132,158-186,228-244,340-375`; controller boundary at `origin/main@9fa2761:apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart:908-922`). React's Files panel filters `files` fixture state and only writes a visible route trace on search/list/content/refresh (`apps/web/src/components/Inspector.tsx:128-163`). The live gateway exposes no file domain (`apps/web/src/gateway/index.ts:4-7,79-86`; `apps/web/src/gateway/sessions.ts:20-31`). No React live implementation found.

4. **Inspect and act on real session and repository changes.** Flutter fetches session `FileDiff` data, refetches on `session.diff`, switches between session, all-uncommitted (`mode=git`), and default-branch (`mode=branch`) scopes, exports the raw patch, and performs real revert/unrevert (`origin/main@9fa2761:apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart:254-260,658-689,806-830,939-959`; `origin/main@9fa2761:apps/desktop_flutter/lib/features/agents/views/_changes_tab.dart:35-56,82-110,128-157,206-239,388-425`). React renders two constant `diffEntries`; scope, export, revert, and restore only change local state or a trace (`apps/web/src/components/Inspector.tsx:33-82`; fixture mutations at `apps/web/src/store.tsx:329-332`). Its live gateway has no diff, VCS, raw-patch, revert, or unrevert methods (`apps/web/src/gateway/sessions.ts:20-31`). No React live implementation found.

5. **Select or create a real branch, handle a dirty checkout, and preserve the resolved worktree identity in live mode.** Flutter loads the selected project's current/local/recent branches, can create a named branch, asks to stash before switching a dirty tree, sends canonical `branch`, `stash`, `createBranch`, `isolateWorktree`, and `worktreeName`, and retains `worktreeName`, `worktreePath`, and `worktreeBranch` (`origin/main@9fa2761:apps/desktop_flutter/lib/features/agents/views/agents_view.dart:3055-3070,3115-3145,3160-3224,3390-3429,3431-3571`; `origin/main@9fa2761:apps/desktop_flutter/lib/features/agents/models/agent_session.dart:159-166,198-204`). React's live form visibly offers Browse, branch, new-branch, and stash controls, but Browse assigns the fixture literal `/workspace/rhythm` and live submit sends only `{name,cwd,profileId,isolateWorktree,worktreeName}`; branch/create/stash are sent only to the fixture store (`apps/web/src/components/SessionRail.tsx:76-102,175-180`). The live mapper also drops `worktreeName`, `worktreePath`, and `worktreeBranch` and substitutes `branch: 'main'` when `source.branch` is absent (`apps/web/src/gateway/sessions.ts:94-106`). React can request isolated creation, but cannot perform the rest of Flutter's live branch/worktree selection contract.

6. **Reset or remove a live isolated worktree from the session UI and observe the server result.** Flutter exposes reset for an isolated session and remove only after the session is closed, calls the real endpoints, surfaces failure, and replaces the local session with the returned metadata-cleared row (`origin/main@9fa2761:apps/desktop_flutter/lib/features/agents/views/_changes_tab.dart:249-330,333-374`; `origin/main@9fa2761:apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart:2447-2480`; `origin/main@9fa2761:apps/desktop_flutter/lib/features/agents/data/agents_data_source.dart:461-482`). React renders the same buttons, but they call fixture-store functions; the gateway exposes neither endpoint (`apps/web/src/components/Inspector.tsx:38-55,77-82`; `apps/web/src/store.tsx:366`; `apps/web/src/gateway/sessions.ts:20-31`). No React live implementation found.

## Known Phase 6 defect — false-success hard-delete cleanup

This is an existing shared backend defect, not an additional Flutter-only capability.

React hard-delete sends body `{removeWorktree:true}` and treats any HTTP 204 as success (`apps/web/src/gateway/sessions.ts:63-71,167`; UI removal at `apps/web/src/store.tsx:266-275`). The API deliberately treats worktree removal as best effort: it awaits `removeWorktree`, ignores its boolean result, catches errors, deletes the SDK session/local row, and returns 204 anyway (`apps/api_server/src/controllers/agent_sessions_controller.ts:1547-1604`). By contrast, the dedicated remove routes reject `ok === false` as `WORKTREE_REMOVE_FAILED` (`apps/api_server/src/controllers/agent_sessions_controller.ts:1640-1655`; wrapper route `apps/api_server/src/routes/opencode_worktrees_routes.ts:107-117`).

The defect was observed three times: each isolated hard-delete returned 204 while the API log recorded `removeWorktree HTTP 400` (`docs/ai/runs/evidence/createworktree-timing-curl.txt:33-37`; `docs/ai/runs/evidence/createworktree-timing-api.txt:5,16,27`). The local rows were gone, but three `opencode/smoke-timing-*` branches remained until explicit cleanup (`docs/ai/runs/evidence/createworktree-timing-cleanup.txt:6-17`). Root cause is not confirmed; the inventory does not guess one.

HTTP status and local-row absence are therefore insufficient cleanup evidence. Git cleanup has three independent states and Phase 6 must inspect each separately:

- registry: the nonce path is absent from `git worktree list --porcelain`;
- filesystem: the exact nonce worktree directory does not exist;
- ref: the exact nonce `refs/heads/opencode/<name>` (or returned `worktreeBranch`) does not exist.

The fork's remove implementation makes that separation explicit: it finds the registry entry, runs `git worktree remove --force`, removes the directory, then deletes the branch; branch deletion can fail after registry/filesystem cleanup (`apps/opencode_fork/packages/opencode/src/worktree/index.ts:390-445`).

## Capability-family detail

### Files, mentions, and attachment transport

The backend already exposes the live boundary React needs. Session file routes are `find-text`, `find-files`, `list`, `content`, and `status` (`apps/api_server/src/routes/agent_sessions_routes.ts:83-89`). The controller resolves `session.worktreePath ?? session.cwd`, rejects traversal after canonical realpath containment, caps the JSON content response at 2 MiB, and adds `resolvedPath` only for the local binary-reference workflow (`apps/api_server/src/controllers/agent_sessions_controller.ts:2399-2498`). Existing coverage proves query forwarding, ordinary traversal denial, symlink-escape denial, the 413 cap, and canonical contained `resolvedPath` (`apps/api_server/src/__tests__/issue_1060_file_find_proxy.test.ts:68-112,115-198`).

The live input transport also exists. A FilePart is `{type:'file',mime,filename?,url}` and text is `{type:'text',text}` (`apps/api_server/vendor/opencode-ai-sdk/gen/types.gen.d.ts:1231-1252`; fork source `apps/opencode_fork/packages/opencode/src/session/message-v2.ts:418-442`). The WebSocket test proves the API forwards canonical parts verbatim and rejects a payload over 20 MiB (`apps/api_server/src/__tests__/opc_m4_1_file_attachments.test.ts:111-174,209-257`). The React gap is client ingestion and forwarding, not an absent API/fork primitive.

Security boundary: user-visible search/list/diff results must use normalized session-relative paths. `FileNode.absolute` and the API-added `resolvedPath` are local implementation values needed for bounded file-reference construction; they must not appear in renderer errors, traces, packaged UI, logs exposed to users, or remote/mobile responses. A foreign local session ID must fail before any file content is returned.

### Files browser and server-side search

Flutter mounts Files as a real inspector tab and Changes as a controller-backed tab (`origin/main@9fa2761:apps/desktop_flutter/lib/features/agents/views/_session_side_panel.dart:53-71,125-145,191-201`). React mounts visually corresponding tabs (`apps/web/src/components/Inspector.tsx:8-10`), but both panels currently consume fixture arrays. `ToolWorkspace.tsx` contains no Phase 6 live file/diff/worktree surface; its matching file/search strings belong to unrelated fixture tools such as managed catalogs and Gallery (`apps/web/src/components/ToolWorkspace.tsx:179-191,234-249`).

The fork's declared file shapes are:

- node `{name,path,absolute,type:'file'|'directory',ignored}`;
- content `{type:'text'|'binary',content,diff?,patch?,encoding?:'base64',mimeType?}`;
- git file status `{path,added,removed,status:'added'|'deleted'|'modified'}`.

They are declared at `apps/opencode_fork/packages/opencode/src/file/index.ts:20-61`; generated SDK declarations mirror them at `apps/api_server/vendor/opencode-ai-sdk/gen/types.gen.d.ts:1365-1398`.

### Session changes, VCS diffs, and patch export

Session diff and VCS diff are different contracts:

- `GET /agent-sessions/:id/diff` is typed by the API against the v1 SDK `FileDiff` declaration: `{file,before,after,additions,deletions}` (`apps/api_server/vendor/opencode-ai-sdk/gen/types.gen.d.ts:32-38`; wrapper `apps/api_server/src/services/opencode_client_service.ts:2048-2068`). Existing API coverage verifies that exact shape reaches the controller consumer (`apps/api_server/src/__tests__/opc_m3_1_changes_tab_diff.test.ts:23-33,146-179`). The fork's newer internal `SnapshotFileDiff` `{file?,patch?,additions,deletions,status?}` is a separate shape and must not be substituted at this boundary (`apps/api_server/vendor/opencode-ai-sdk/v2/gen/types.gen.d.ts:2169-2175`).
- `GET /agent-sessions/:id/vcs/diff?mode=git|branch` returns `VcsFileDiff` `{file,patch?,additions,deletions,status?}`; `/vcs/diff/raw` returns `text/x-diff` (`apps/api_server/src/controllers/agent_sessions_controller.ts:2521-2538`; canonical fork declarations `apps/opencode_fork/packages/opencode/src/project/vcs.ts:227-245`). `git` means working tree versus HEAD; `branch` means current branch versus the merge base with the default branch (`apps/opencode_fork/packages/opencode/src/project/vcs.ts:355-380`).

React currently reports a route trace for these endpoints but performs no request. Phase 6 evidence must assert returned path/content, not the presence of the trace string.

### Worktree creation, branch isolation, and direct actions

React does have one real Phase 6 capability today: live advanced creation can send `isolateWorktree:true` and optional `worktreeName` (`apps/web/src/components/SessionRail.tsx:76-83`; gateway declaration and POST at `apps/web/src/gateway/sessions.ts:20-26,149-164`). The API creates the worktree before the session, changes session `cwd` to the returned `directory`, and persists `worktreeName`, `worktreePath`, and `worktreeBranch` (`apps/api_server/src/controllers/agent_sessions_controller.ts:855-885,911-947`; existing test `apps/api_server/src/__tests__/issue_1058_isolate_worktree.test.ts:72-95`). The React mapper keeps the returned `cwd` and a derived boolean, so its Context panel can show the resolved directory, but it discards the three named worktree fields and does not expose the returned branch.

The engine creates branch `opencode/<slug>` under a global worktree root and returns `{name,branch?,directory}` (`apps/opencode_fork/packages/opencode/src/worktree/index.ts:41-59,185-223,225-304`). The API wrapper surface uses `{directory,name?,startCommand?}` for create and `{directory,worktreeDir}` for remove/reset (`apps/api_server/src/routes/opencode_worktrees_routes.ts:1-14,93-127`). The lower engine remove/reset body uses `{directory:<target worktree directory>}` while the instance/project directory is supplied separately by the SDK request context (`apps/opencode_fork/packages/opencode/src/worktree/index.ts:48-64`). These similarly named fields must not be conflated.

### Complete cleanup

The current live E2E proves create/list/reset/remove only by checking the created directory disappears; it does not check the git registry and branch ref independently (`apps/api_server/src/__tests__/live_e2e_1057_worktree.test.ts:42-78`). The mock isolation test accepts a hard-delete 204 after merely asserting the wrapper was called and cannot catch false success (`apps/api_server/src/__tests__/issue_1058_isolate_worktree.test.ts:110-125`). Phase 6 must replace that evidentiary weakness with real three-state Git assertions on success, timeout, cancel, assertion failure, provider failure, and cleanup retry, plus DB/files/listeners/sockets. Every nonce resource must be owned by the test, and all pre-existing worktrees/branches must be snapshotted and preserved.

## Canonical persisted and transport vocabulary

Display strings such as “All uncommitted”, “vs main”, “worktree”, or React's `fileUrl` are not API vocabulary.

| Concept | Canonical field names and value shapes | Authoritative declaration/evidence |
|---|---|---|
| Composer text part | `{type:'text',text:string}`; optional SDK fields may exist but are not required from the renderer | `apps/api_server/vendor/opencode-ai-sdk/gen/types.gen.d.ts:1231-1244` |
| Composer file part | `{type:'file',mime:string,filename?:string,url:string}`; `url` is `data:` for provider-readable media or a contained local `file:` reference | `apps/api_server/vendor/opencode-ai-sdk/gen/types.gen.d.ts:1245-1252`; `origin/main@9fa2761:apps/desktop_flutter/lib/features/agents/views/_attachment_mime.dart:116-131` |
| Live input frame | `{v:1,type:'session.input',id:<local session id>,parts:[...]}`; legacy text-only form uses `data:string` | `apps/api_server/src/__tests__/opc_m4_1_file_attachments.test.ts:124-167,178-200` |
| File search | `query:string`, optional `limit:number`, optional `type:'file'|'directory'`; text search uses `pattern:string` | `apps/api_server/src/controllers/agent_sessions_controller.ts:2430-2453` |
| File list/content input | `path` is session-relative; list defaults to `'.'`; content requires a non-empty value | `apps/api_server/src/controllers/agent_sessions_controller.ts:2456-2470` |
| File node | `{name,path,absolute,type:'file'|'directory',ignored:boolean}` | `apps/opencode_fork/packages/opencode/src/file/index.ts:27-34` |
| File content | `{type:'text'|'binary',content,diff?,patch?,encoding?:'base64',mimeType?}`; local API may append contained `resolvedPath` | `apps/opencode_fork/packages/opencode/src/file/index.ts:53-61`; `apps/api_server/src/controllers/agent_sessions_controller.ts:2471-2486` |
| File status | `{path,added,removed,status:'added'|'deleted'|'modified'}` | `apps/opencode_fork/packages/opencode/src/file/index.ts:20-25` |
| Session diff API | `{file:string,before:string,after:string,additions:number,deletions:number}` | `apps/api_server/vendor/opencode-ai-sdk/gen/types.gen.d.ts:32-38`; typed wrapper `apps/api_server/src/services/opencode_client_service.ts:2048-2068` |
| Fork snapshot diff (not the API wrapper shape above) | `{file?:string,patch?:string,additions:number,deletions:number,status?:'added'|'deleted'|'modified'}` | `apps/api_server/vendor/opencode-ai-sdk/v2/gen/types.gen.d.ts:2169-2175` |
| VCS identity | `{branch?:string,default_branch?:string}` | `apps/opencode_fork/packages/opencode/src/project/vcs.ts:221-225` |
| VCS diff mode | `mode:'git'|'branch'`; unknown/omitted normalizes to `git` at the API | `apps/api_server/src/controllers/agent_sessions_controller.ts:2521-2525` |
| VCS diff/status | diff `{file,patch?,additions,deletions,status?}`; status `{file,additions,deletions,status}`; status values are `added | deleted | modified` | `apps/api_server/vendor/opencode-ai-sdk/v2/gen/types.gen.d.ts:2958-2969` |
| Session create branch inputs | `branch:string`, `stash:'stash'|'discard'` (omitted becomes API `none`), `createBranch:boolean` | `apps/api_server/src/controllers/agent_sessions_controller.ts:823-850`; lower checkout type at `apps/api_server/src/services/vcs_probe.ts:119-120` |
| Isolated create inputs | `isolateWorktree:true`, optional `worktreeName:string`; base project directory remains request `cwd` | `apps/api_server/src/controllers/agent_sessions_controller.ts:855-879` |
| Persisted session worktree identity | `worktreeName:string|null`, `worktreePath:string|null`, `worktreeBranch:string|null`; isolated session `cwd` is the worktree path | `apps/api_server/src/models/agent_session.ts:138-144`; `apps/api_server/src/controllers/agent_sessions_controller.ts:926-947` |
| Engine worktree | `{name:string,branch?:string,directory:string}`; generated branch is `opencode/<slug>` | `apps/opencode_fork/packages/opencode/src/worktree/index.ts:41-59,185-205` |
| API worktree wrapper | create body `{directory,name?,startCommand?}`; remove/reset body `{directory,worktreeDir}` | `apps/api_server/src/routes/opencode_worktrees_routes.ts:9-14,93-127` |
| Engine remove/reset input | `{directory:<target worktree directory>}` | `apps/api_server/vendor/opencode-ai-sdk/v2/gen/types.gen.d.ts:3014-3019` |
| Dedicated session actions | `POST /agent-sessions/:id/worktree/reset`; `POST /agent-sessions/:id/worktree/remove` | `apps/api_server/src/routes/agent_sessions_routes.ts:110-112` |
| Hard-delete cleanup flag | `removeWorktree:true` in body or query literal `removeWorktree=true` | `apps/api_server/src/controllers/agent_sessions_controller.ts:1559-1565` |

## Inventory conclusion

React/Electron can request a live isolated worktree and receives its resolved `cwd`, and the shared backend/fork already implement file/find, diff/VCS, worktree creation/reset/removal, and canonical attachment parts. React cannot perform the six live capability groups listed first because the renderer remains fixture-backed and the live gateway omits those operations or drops their payload fields. Independently, hard-delete currently reports 204 after failed engine cleanup, so Phase 6 completion must be based on observable Git registry, filesystem, and branch-ref state—not HTTP status or local-row deletion alone.
