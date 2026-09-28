# Resizable pane contract

Every boundary between persistent adjacent view panes uses `apps/web/src/components/Splitter.tsx`. A grid of cards, a form field grid, a toolbar beside content, or a table's data columns is not a pane boundary. A navigation rail, item list, workspace, inspector, preview, terminal, or other independently scrollable adjacent region is a pane and must use `Splitter`.

## Interaction contract

- Use `orientation="vertical"` for side-by-side panes and `orientation="horizontal"` for stacked panes.
- Give every separator a durable accessible name. The separator exposes orientation plus current, minimum, and maximum pixel values.
- Pointer resizing uses pointer capture. Pointer up, pointer cancel, window blur, lost capture, and unmount all end the gesture and restore body text selection.
- Arrow keys change size by 16 px; Shift+Arrow changes it by 64 px. Home and End choose the bounds. Enter and double-click restore the default.
- `resizeEdge="start"` means the pane before the separator owns the stored size. Use `resizeEdge="end"` when the pane after it owns the size.
- Keep pane state outside the splitter. Resizing must not change selection, recreate records, or remount an active session.
- The saved preferred size is constrained to the configured bounds. The rendered size is also clamped to the available parent space; a temporarily narrow window does not discard the wider preferred size.
- Splitter changes dispatch a window `resize` event so terminals, editors, calendars, and sandboxed artifact previews can remeasure their container.

## Storage keys

Layout preferences use numeric pixel values in local storage under `layout.*` keys:

| Boundary | Key |
| --- | --- |
| Shell navigation / content | `layout.shell.navigation` |
| Agents session rail / conversation | `layout.agents.rail` |
| Agents conversation / inspector | `layout.agents.inspector` |
| Agents session list / Tools panel | `layout.agents.tools` |
| Tasks collection / task detail | `layout.tasks.detail` |
| Rhythms collection / rhythm detail | `layout.rhythms.detail` |
| Planner day boundaries | `layout.planner.day-1` through `layout.planner.day-6` |
| Profiles list / profile editor | `layout.profiles.rail` |
| Hermes status / embedded workspace | `layout.hermes.status-width` or `layout.hermes.status-height` |
| Shared list / inspector | `layout.list-inspector.<label-slug>` |
| Future route-specific boundary | `layout.<route>.<stable-boundary-name>` |

Do not include a selected record ID, active tab ID, translated label, or generated React ID in a storage key. `resetSplitterSizes()` removes all `layout.*` keys. Main Settings > Appearance and keyboard exposes this as **Reset layout**.

## Route and tab inventory

The Shell boundary applies to every route in `apps/web/src/App.tsx`. The current web Shell places global navigation above content, so its separator is horizontal. If navigation returns to a side rail, retain the storage key and switch the same boundary to a vertical splitter.

| Route or screen | Pane boundary | Status |
| --- | --- | --- |
| `/agents` | Session rail / active conversation | Covered by `AgentsWorkspace` and `layout.agents.rail`. |
| `/agents` | Active conversation / inspector tabs (Context, Changes, Terminal, Files, Artifacts) | Covered by `AgentsWorkspace` and `layout.agents.inspector`; inspector tab state remains mounted. |
| `/agents` | Session list / stacked Tools panel | Covered by `SessionRail` and `layout.agents.tools`. |
| `/dashboard` | Dashboard card, metric, planning, and context grids | No persistent pane boundary; these are responsive content grids. |
| `/dashboard` live artifact tabs | Toolbar / artifact iframe | No fixed pane boundary in the current surface. The iframe flexes to its container and receives the shared resize notification. |
| `/planner`, week view | Each adjacent pair of the seven day lanes | Covered by six independent splitters and `layout.planner.day-1` through `layout.planner.day-6`. Agenda is a single column; task and event details are modal. |
| `/tasks`, `/tasks/task/:id`, list and board tabs | Task list or board / selected task detail | Covered by `layout.tasks.detail`; the compact view keeps task details in a modal. |
| `/rhythms`, rule/detail states | Rhythm list / rule inspector | Covered by `layout.rhythms.detail`; the responsive single-column view has no adjacent pane boundary. |
| `/projects`, templates and instances tabs | Project list / selected template or instance inspector | Covered transitively by `ListInspector` with `layout.list-inspector.projects`. |
| `/messages`, thread states | Conversation list / active conversation | Covered transitively by `ListInspector` with `layout.list-inspector.conversations`. |
| `/facilities`, overview, reservations, and rooms | Facility or reservation list / detail | Covered transitively by `ListInspector` with `layout.list-inspector.facility-reservations` or `layout.list-inspector.facility-rooms`. |
| `/automations`, automation states | Automation list / detail | Covered transitively by `ListInspector` with `layout.list-inspector.automation-rules`. |
| `/integrations`, provider and import states | Provider list / provider detail | Covered transitively by `ListInspector` with `layout.list-inspector.integrations`; the import flow is a single wizard surface. |
| `/profiles` | Profile rail / profile settings and functions | Covered by `layout.profiles.rail`. |
| `/endpoint-map` | Endpoint table | No adjacent view pane boundary. |
| `/hermes` | Connection status / embedded Hermes workspace | Covered by `layout.hermes.status-width` on wide layouts and `layout.hermes.status-height` when stacked. The embedded view receives resize notifications. |
| `/mobile-access` | Pairing and device content | No adjacent view pane boundary. |
| `/settings` | Settings sections | No adjacent view pane boundary; contains the shared Reset layout action. |
| unknown route | Recovery page | No adjacent view pane boundary. |

### Agent Tool routes (`/tools/:slug`)

| Tool/tab | Pane boundary | Status |
| --- | --- | --- |
| Brain (`brain`) | Agent memories / memory detail | Covered transitively by `ListInspector` with `layout.list-inspector.agent-memories`. |
| Deep Research (`deep-research`) | Research projects / run detail and evidence tabs | Covered transitively by `ListInspector` with `layout.list-inspector.research-projects`. |
| Tasks (`tasks`) | Scheduled jobs / inspector | Covered transitively by `ListInspector` with `layout.list-inspector.scheduled-agent-jobs`. |
| Webhooks (`webhooks`) | Webhook endpoints / endpoint detail | Covered transitively by `ListInspector` with `layout.list-inspector.webhook-endpoints`. |
| Skills (`skills`) | Skill list / content detail | Covered transitively by `ListInspector` with `layout.list-inspector.skills`. |
| Playbooks (`playbooks`) | Playbook list / content detail | Covered transitively by `ListInspector` with `layout.list-inspector.playbooks`. |
| Cookbook (`cookbook`) | Recipe list / recipe detail | Covered transitively by `ListInspector` with `layout.list-inspector.cookbook-recipes`. |
| Review Queue (`review`) | Proposal list / proposal detail | Covered transitively by `ListInspector` with `layout.list-inspector.organization-proposals`. |
| Report Card (`report-card`) | Agent list / run-quality detail | Covered transitively by `ListInspector` with `layout.list-inspector.agent-report-cards`. |
| Email (`email`) | Signal list / message detail | Covered transitively by `ListInspector` with `layout.list-inspector.email-signals`. |
| Gallery (`gallery`) | Artifact list / artifact detail | Covered transitively by `ListInspector` with `layout.list-inspector.creative-media-artifacts`. |
| Agent Settings (`agent-settings`) | Settings section list / section editor | Covered transitively by `ListInspector` with `layout.list-inspector.agent-settings-sections`. |
| Profiles tool entry | Navigation redirects to `/profiles` | Covered by the `/profiles` inventory row. |

## Review checklist for new screens

1. Inventory every route, tab, expanded state, and dialog that reveals adjacent independently scrollable regions.
2. Add one `Splitter` per boundary with stable bounds and a `layout.*` key.
3. Verify pointer capture across embedded content, pointer cancel, keyboard bounds and reset, RTL, 200% zoom, narrow-window clamp and restore, reload persistence, and Settings reset.
4. Verify the neighboring panes reflow without page-level horizontal overflow and without losing selection, edits, scroll position, session state, terminal state, or artifact state.
