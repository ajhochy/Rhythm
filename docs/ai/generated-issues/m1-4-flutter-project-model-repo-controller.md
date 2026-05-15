# M1-4 — Flutter: Project model + repository + controller (with VCS fields)

**Milestone:** M1 — Sessions ↔ Projects
**Branch:** `m1-projects`
**Depends on:** M1-1

## Summary

Add the standard Flutter feature layer for projects (model / data source / repository / controller) following the existing pattern used by `tasks`, `rhythms`, `projects` (the legacy template feature — rename if collision), etc. The model carries the new VCS fields (`vcsRoot`, `vcsBranch`, `vcsDirty`). The controller exposes `refreshVcs(id)` that hits `POST /projects/:id/refresh-vcs`. No UI in this issue — that's M1-5 / M1-6.

## Motivation

M1-5 and M1-6 need a `ProjectController` ready to consume. Building the data layer first matches the existing pattern (every feature follows: view ↔ controller ↔ repository ↔ data source ↔ model) and lets the UI work be a thin wrapper.

## Likely files

- `apps/desktop_flutter/lib/features/projects/models/project.dart` — **NEW** (current `lib/features/projects/` is the project-templates feature; place this under a sibling folder if needed to avoid collision — see Notes)
- `apps/desktop_flutter/lib/features/projects/data/projects_remote_data_source.dart`
- `apps/desktop_flutter/lib/features/projects/repositories/projects_repository.dart`
- `apps/desktop_flutter/lib/features/projects/controllers/projects_controller.dart`
- `apps/desktop_flutter/lib/main.dart` — register `ChangeNotifierProvider<ProjectsController>`
- `apps/desktop_flutter/test/features/projects/projects_controller_test.dart`

## Naming collision

The existing `lib/features/projects/` is the **project templates** feature (template/instance/step). To avoid breaking it, this issue introduces the new Agent-projects layer under:

```
lib/features/agent_projects/
  models/agent_project.dart
  data/agent_projects_remote_data_source.dart
  repositories/agent_projects_repository.dart
  controllers/agent_projects_controller.dart
```

Class names: `AgentProject`, `AgentProjectsController`, etc. UI files (M1-5/M1-6) live under `lib/features/agents/views/` since they're surfaced in the Agents screen.

## Model

```dart
class AgentProject {
  final String id;
  final String name;
  final String cwd;
  final String? icon;          // emoji or "#hex"
  final String? vcsRoot;       // null for non-git
  final String? vcsBranch;     // null for non-git or detached HEAD
  final bool vcsDirty;
  final DateTime? vcsCheckedAt;
  final DateTime createdAt;
  final DateTime? archivedAt;

  factory AgentProject.fromJson(Map<String, dynamic> json);
  Map<String, dynamic> toJson();
}
```

## Controller surface

`AgentProjectsController extends ChangeNotifier`:

| Field / method | Behavior |
|---|---|
| `List<AgentProject> projects` | Loaded list (sorted createdAt DESC, archived excluded) |
| `String? selectedProjectId` | null = "All sessions" pseudo-project |
| `LoadStatus status` | `idle` / `loading` / `error` (existing enum pattern) |
| `String? error` | Human-readable last error |
| `Future<void> load({bool includeArchived = false})` | GET /projects |
| `Future<AgentProject> create({name, cwd, icon})` | POST /projects; refreshes list |
| `Future<AgentProject> update(id, {name?, cwd?, icon?, archivedAt?})` | PATCH /projects/:id |
| `Future<void> archive(id)` | PATCH archivedAt = now |
| `Future<void> delete(id)` | DELETE /projects/:id |
| `Future<AgentProject> refreshVcs(id)` | POST /projects/:id/refresh-vcs; updates in-place |
| `void select(String? id)` | Sets `selectedProjectId`, notifies |

Data source constructor takes `baseUrl` from `ServerConfigService.url` (NOT the agent localhost URL — projects are stored in the production-config DB on whatever server the user pointed at, matching how tasks/rhythms work).

**Decision point:** projects are local-only data and belong to the **embedded api_server on `localhost:4001`**, not the user-configured production API. Per CLAUDE.md's Dual-Endpoint rule, agent-related data uses `AppConstants.agentLocalBaseUrl`. Use that, not `serverConfigService.url`.

## Acceptance criteria

1. `AgentProject.fromJson` round-trips every field including null VCS fields.
2. Controller `load()` fetches and populates `projects`; status transitions `idle → loading → idle`.
3. `create` adds the new project to the in-memory list (no re-fetch needed) and notifies listeners.
4. `archive` removes the project from the visible list (unless `includeArchived: true` is later supported).
5. `refreshVcs` replaces the in-memory project with the updated VCS fields and notifies.
6. `select(id)` updates `selectedProjectId` and notifies; `select(null)` switches to the "All sessions" pseudo-project.
7. `flutter analyze --no-fatal-infos` clean.
8. `dart format --set-exit-if-changed` clean.
9. `flutter test` passes (existing 180 + new tests).
10. `ai-workflow checks --level pr` exits 0.

## Required tests (`projects_controller_test.dart`)

Mock the data source (or use a fake `HttpClient`):
- `load()` populates projects on success and sets `error` on HTTP failure.
- `create()` posts and appends to the in-memory list.
- `update()` patches and replaces the matching id.
- `archive()` removes the row from `projects`.
- `delete()` removes the row.
- `refreshVcs()` updates VCS fields without touching other fields.
- `select(id)` / `select(null)` updates `selectedProjectId` and emits `notifyListeners`.

## Data safety / out of scope

- No UI in this issue — sidebar rail + dialogs land in M1-5 / M1-6.
- Use `AppConstants.agentLocalBaseUrl` (`http://localhost:4001`), NOT `serverConfigService.url`. Agent traffic must never couple to the production API per CLAUDE.md.
- Do NOT add session-listing changes here; M1-5 wires `AgentSessionsController.listByProject(id)` separately.
- Do NOT introduce a `package:dio` or other new HTTP library — match the existing `package:http` pattern.

## Notes

- The folder name `agent_projects` is verbose but unambiguous. If the legacy `lib/features/projects/` ever gets renamed (it's `project_template_*` internally), we can rename this back to `projects/`. Don't rename the legacy feature in this issue — out of scope.
- VCS fields are read-only from the client perspective; the server is the source of truth. The controller never sets them locally except via `fromJson`.
