# Upstream Colony action inventory

Source reviewed: `/private/tmp/bot-crossing-colony-artifact/src/ui/hud.js` at the lane-provided companion checkout. “Removed” means not rendered or registered in embedded mode. “Deferred” means no first-release control is exposed; qualification must arrive in a separate issue. No row silently falls through to a generic action.

## Fixed buttons

| Upstream id | Upstream label/action | Final Rhythm location | Disposition and reason |
| --- | --- | --- | --- |
| `btn-shot` | Screenshot (`P`) | View → Screenshot | Kept; disabled with reason in list fallback/no-WebGL. Uses normal host save path. |
| `btn-help` | Help (`?`) | View → Keyboard help | Kept as a Rhythm `Menu`/dialog; no upstream branded sheet. |
| `btn-hide` | Hide all UI (`H`, `Cmd/Ctrl+\`) | View → Focus scene | Kept as “Focus scene”; hides workspace panes, not global Rhythm chrome. |
| `btn-settings` | Settings (`S`) | View → Advanced quality; Settings → Local apps → Bot Crossing | Split by purpose; no duplicate settings drawer over the scene. |
| `btn-hidden-toggle` | Show hidden repositories | Rail filter menu → Hidden repositories | Kept; hidden group is collapsed by default. |
| `btn-close-project` | Back to overview (`Esc`) | Rail breadcrumb / Back to list | Kept with specified focus return. |
| `btn-locate` | Fly to repository zone | Repository row/task menu → Locate in scene | Kept; disabled without WebGL. |
| `btn-new-session` | New conversation (`C`) | None | **Removed.** New-session creation is unqualified and outside the first packaged action contract. No shortcut registered. |
| `btn-reveal` | Reveal in Finder/Explorer/Files | Repository task menu → Show in Finder | Kept after current-inventory path resolution in main. |
| `btn-copy-path` | Copy folder path | Repository task menu → Copy path | Kept; copies the resolved current path. |
| `btn-hide-project` | Hide from colony | Repository task menu → Hide from Bot Crossing | Kept; writes only profile-scoped Colony preference. Restore is in Hidden repositories. |
| `btn-home` | Reset view (`0`) | View → Reset camera; scene toolbar Icon | Kept; canvas-scoped `0` only. |
| `btn-next` | Next needing attention (`N`) | Scene toolbar Icon + rail “Needs attention” counter | Kept; canvas-scoped `N`, disabled when count is zero. |
| `btn-orbit` | Orbit (`O`) | View → Camera → Orbit | Kept as checked menu item; forced off for reduced motion. |
| `btn-planet` | Change planet (`Tab`) | View → World → Planet submenu | Kept; **Tab shortcut removed** because Tab is focus navigation. |
| `btn-time` | Change time (`L`) | View → World → Time of day submenu | Kept; canvas-scoped `L`. |
| `btn-sound` | Mute (`M`) | View → Sound → Ambient sound | Kept as checked item; canvas-scoped `M`. |
| `btn-close-settings` | Close settings | Menu close / Settings back | Kept through incumbent Menu/Escape behavior; the upstream drawer is removed. |
| `btn-follow` | Follow selected bot | View → Camera → Follow selected bot | Kept; checked, disabled without a selected task. |
| `btn-deselect` | Deselect (`Esc`) | Inspector close / Back to list | Kept with topmost-overlay and focus-return rules. |
| `btn-open` | Open exact thread (`Enter`) | Inspector primary action: Open in Rhythm / Open in Codex | Kept only when capability-qualified. Unsupported harness is disabled with its reason. |
| `btn-open-terminal` | Resume in terminal | None | **Removed.** Terminal resume is unqualified, conflicts with Rhythm terminal/composer ownership, and is outside the first action contract. |
| `btn-viewed` | Mark viewed (`V`) | Task menu → Mark viewed | Kept; canvas-scoped `V`, profile state only. |
| `btn-archive` | Archive (`A`) | Task menu → Archive from Colony / Restore to Colony | Kept and relabeled; never deletes harness/source records. Archived filter provides restore. |
| `btn-help-close` | Close help | Dialog action “Done” | Kept using Rhythm dialog/button tokens; returns focus to View trigger. |

## Filters and form controls

| Upstream id/control | Upstream action | Final Rhythm location | Disposition |
| --- | --- | --- | --- |
| `filter-query` | Search project, branch, path, task | Rail Search (`ListInspector`) | Kept, always visible. |
| `filter-harness` | Harness select | Rail filter row | Kept. All harness values remain distinguishable. |
| `filter-status` | Activity/status select | Rail filter row | Kept, including Active, Quiet, Unknown, Needs attention, Workers, Archived. |
| `filter-historical` | Include historical locations | Rail filter menu | Kept off by default; missing/unresolved is explicit. |
| `openIn` select | Desktop app / Terminal | None | **Removed.** Replaced by capability-qualified Open in Rhythm/Open in Codex; Terminal option is not exposed. |
| `shadows` select | Off/Low/High/Ultra | View → Quality preset; Advanced quality | Kept in advanced settings. |
| `particles` select | Off/Low/Full | View → Quality preset; Advanced quality | Kept in advanced settings. |
| `textureQuality` select | Low/Medium/High/Ultra | View → Quality preset; Advanced quality | Kept in advanced settings. |
| `groundDetail` select | Low/Medium/High | View → Quality preset; Advanced quality | Kept in advanced settings. |
| `fauna` select | Off/Some/Full | View → World; Advanced quality | Kept in advanced settings. |

## Generated buttons, rows, and disclosures

| Upstream control family | Current action | Final location | Disposition |
| --- | --- | --- | --- |
| Stat buttons: building, need you, blocked, shipped, tasks, workers | Focus next matching bot | Rail status summary/filter | Kept; empty counts are disabled, text + dot convey status. |
| Repository buttons | Select/open repository | Rail repository rows | Kept via `ListInspector`; row retains full path tooltip/accessible name. |
| Thread/worker rows | Select bot/task | Nested task rows + scene bot | Kept; one shared selection ID. |
| Hidden repository “Show” | Unhide repository | Hidden repositories menu | Kept as Restore to Bot Crossing. |
| Dormant repositories “Show” | Disable dormant fold | Filter menu | Kept as Include quiet repositories. |
| Parent task button | Select parent | Inspector → Show parent task | Kept with the required label. |
| Project detail disclosure / Task details | Reveal details | Inspector sections | Kept; ordinary disclosure with persisted open state only if profile-owned. |
| Quality preset chips | Apply preset | View → Quality | Kept as one checked menu choice: Auto/High/Balanced/Low. |
| Planet buttons | Choose world | View → World → Planet | Kept as one checked submenu choice. |
| Time chips including Live | Choose lighting time | View → World → Time of day | Kept as one checked submenu choice. |

## Generated settings inventory

All settings use Rhythm `Menu` for common choices and the existing Settings form vocabulary for advanced values. There is no orange parallel control system.

| Group | Upstream controls | Final location/disposition |
| --- | --- | --- |
| Performance | HDR + bloom; Tilt-shift; Tilt-shift blur; Tilt-shift angle; Shadows; Particles; Textures; Ground detail; Anti-aliasing; Render scale; Adaptive quality; Scatter; Max bots; Stars | Quality preset in View; all individual values in Advanced quality. Kept. |
| Lighting | Time of day; Cycle day/night; Cycle length; Environment light; Environment; Exposure; Bloom | Time choice in View; individual values in Advanced quality. Kept. |
| View | Hide dormant repos; Follow selected bot; Return to isometric; Field of view; Project labels; Reduced motion; Show FPS | Common checked items in View; FOV/FPS in Advanced quality. Kept. OS reduced-motion can force motion lower, never higher. |
| Look | Ambient occlusion; World curve; Colour grade; Saturation; Vignette; Clouds; Wildlife | World/Quality menus plus Advanced quality. Kept. |
| Sound | Ambient sound; Master; Ambience; Effects | Ambient sound checked in View; volumes in Settings. Kept. |

## Gestures and displayed shortcuts

| Upstream shortcut | Upstream action | Embedded disposition |
| --- | --- | --- |
| `drag` | Pan ground | Kept when scene canvas is focused. |
| `right-drag` | Tilt/rotate | Kept when scene canvas is focused. |
| `⌃ or ⇧ + drag` | Alternate tilt/rotate | Kept when scene canvas is focused. |
| `scroll` | Zoom to cursor | Kept over scene; never captures rail/inspector scroll. |
| `arrows` | Move camera | Kept only with scene focus; list/menu arrows retain incumbent meaning. |
| `+ −` | Zoom | Kept only with scene focus. |
| `0` | Reset view | Kept only with scene focus. |
| `H` | Hide UI | Kept as Focus scene only with scene focus. |
| `Cmd/Ctrl+\` | Hide UI | Removed; reserved for Rhythm pane/terminal behavior. |
| `S` | Settings | Removed as global; View button/Settings route replaces it. |
| `P` | Screenshot | Kept only with scene focus. |
| `N` | Next needing attention | Kept only with scene focus. |
| `Enter` | Open thread | Row Enter selects/inspects; `Cmd/Ctrl+Enter` or labeled Open action opens exact task. |
| `V` | Mark viewed | Kept only with scene focus and selection. |
| `A` | Archive | Kept only with scene focus and selection; menu remains authoritative. |
| `C` | New conversation | Removed with new-session action. |
| `O` | Orbit | Kept only with scene focus and reduced motion off. |
| `Tab` | Change planet | Removed; Tab remains sequential focus navigation. |
| `L` | Time of day | Kept only with scene focus. |
| `M` | Mute | Kept only with scene focus. |
| `Esc` | Deselect/back | Kept with topmost-overlay and focus-return rules. |
| `?` | Help | Kept only with workspace/scene focus and no editable active. |

## Embedded-only additions

| New action | Location | Contract |
| --- | --- | --- |
| Open in Rhythm | Inspector primary / task menu | Exact current local task ID only. |
| Open in Codex | Inspector primary / task menu | Exact supported Codex opaque reference only. |
| Show parent task | Inspector | Selects known parent ID; hidden/unknown parent explains why disabled. |
| Archive from Colony | Task menu | Profile state only; source untouched. |
| Restore to Colony | Archived task menu | Reverses Colony archive and returns focus/selection. |
| Retry scan | Stale/error state | Bounded scanner refresh; never restarts API/engine services. |

