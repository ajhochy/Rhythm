# B2 — Cookbook Flutter feature + nav row

**Labels:** `feature`, `flutter`, `phase-b`
**Depends on:** A1, B1

## Context

With the Cookbook backend in place (B1), this issue adds the full Flutter `agent_cookbook` feature directory (view/controller/repository/data/model) for listing and authoring recipes. The feature wires into the nav column as a 📖 Cookbook TOOLS row.

## Likely files

- NEW `apps/desktop_flutter/lib/features/agent_cookbook/models/cookbook_recipe.dart`
- NEW `apps/desktop_flutter/lib/features/agent_cookbook/data/agent_cookbook_data_source.dart`
- NEW `apps/desktop_flutter/lib/features/agent_cookbook/repositories/agent_cookbook_repository.dart`
- NEW `apps/desktop_flutter/lib/features/agent_cookbook/controllers/agent_cookbook_controller.dart`
- NEW `apps/desktop_flutter/lib/features/agent_cookbook/views/agent_cookbook_view.dart`
- `apps/desktop_flutter/lib/main.dart` (add `ChangeNotifierProvider<AgentCookbookController>` to MultiProvider)
- `apps/desktop_flutter/lib/features/agents/views/_agents_nav_column.dart` (add 📖 Cookbook row to TOOLS group)

## Acceptance criteria

- [ ] `CookbookRecipe` model has fields matching the B1 schema: `id`, `title`, `description`, `stepsJson`, `boundConfigId`, `createdAt`, `updatedAt`, with `fromJson`/`toJson`.
- [ ] `AgentCookbookDataSource` calls `GET /agent-cookbook` (using `serverConfigService.url` as `baseUrl`, matching the pattern of other data sources — NOTE: Cookbook is a production-server resource, not local agent server) and the individual CRUD endpoints.
- [ ] `AgentCookbookController` exposes: `recipes` list, `status` enum (idle/loading/error), `loadRecipes()`, `createRecipe(...)`, `deleteRecipe(id)`.
- [ ] `AgentCookbookView` renders a list of recipes (title + description) with an empty-state message when the list is empty, and a "New Recipe" button that opens a create dialog (title + description + steps fields).
- [ ] `AgentCookbookController` is registered in `main.dart` MultiProvider.
- [ ] The TOOLS group in `_agents_nav_column.dart` includes a 📖 Cookbook row that opens `AgentCookbookView`.
- [ ] `dart format` and `flutter analyze --no-fatal-infos` pass with zero new errors.

## Widget test requirement (real-mounted surface)

Pump the REAL mounted Agents surface:
- Assert the 📖 Cookbook row renders in TOOLS.
- Tap the Cookbook row and assert `AgentCookbookView` is pushed.
- Pump `AgentCookbookView` with a mocked controller returning one recipe; assert the recipe title renders.
- Pump with empty list; assert the empty-state widget renders.

## Required validation commands

```bash
cd apps/desktop_flutter && dart format . && flutter analyze --no-fatal-infos && flutter test
```

## Safety notes

- `AgentCookbookDataSource` uses `serverConfigService.url` (production server), NOT `AppConstants.agentLocalBaseUrl`. Cookbook data is production-server data, not local-agent data.
- No schema changes in this issue (schema is B1).

## Data-safety out-of-scope

No api_server changes in this issue (backend is B1).
