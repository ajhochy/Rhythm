# Rhythm — Review Standard

The enforceable checklist for reviewing any diff in this repo — for humans and
agents alike. If a diff violates a rule here, the review should block until it's
fixed or the rule is consciously waived with a note. This file encodes the
knowledge that used to live only in reviewers' heads (see `CLAUDE.md` and
`AGENTS.md` for the deeper "why").

> **Agents:** run `/code-review` against the working diff and check every
> section below before requesting review. Treat a HIGH/CRITICAL GitNexus
> `impact` result as a blocker to call out explicitly.

---

## 0. Gates that must be green (non-negotiable)

These are also enforced in CI (`desktop_ci.yml`, `server_ci.yml`) — never rely
on CI to catch them, run them locally first.

- [ ] **Flutter:** `dart format --output=none --set-exit-if-changed .` passes.
      CI fails on any formatting drift.
- [ ] **Flutter:** `flutter analyze --no-fatal-infos` is clean.
- [ ] **Flutter:** `flutter test` passes.
- [ ] **API server:** `npm run lint && npm test && npm run build` pass in `apps/api_server`.
- [ ] **GitNexus:** ran `impact({target, direction:"upstream"})` before editing any
      symbol; ran `detect_changes({scope:"compare", base_ref:"main"})` before commit,
      and the affected symbols/flows match the intended change — no surprise blast radius.

---

## 1. Architecture conformance (Flutter)

Every feature follows the exact layered pattern. Reject diffs that skip or blur a layer.

```
views/foo_view.dart          ← StatefulWidget; reads controller via context.watch/read
controllers/foo_controller.dart  ← ChangeNotifier; status enum (idle/loading/error); methods
repositories/foo_repository.dart ← Calls data source; maps DTOs to models
data/foo_data_source.dart    ← HTTP calls; accepts baseUrl constructor param
models/foo.dart              ← Plain Dart class with fromJson/toJson
```

- [ ] No HTTP calls outside a `data/` source. Views/controllers never touch `http`.
- [ ] Controllers extend `ChangeNotifier`, expose a `Status` enum
      (`idle`/`loading`/`error`) + `errorMessage`, and `notifyListeners()` on
      every state transition. No business logic in views.
- [ ] Data sources take `{String? baseUrl}` and default to `AppConstants.apiBaseUrl`;
      they attach `AuthSessionStore.headers()` and call `assertOk(response)`.
- [ ] Models parse via the `asInt`/`asString`/`json_parsing.dart` helpers, not raw casts.
- [ ] New controller + data source + repository are wired in `main.dart`
      `MultiProvider`, and data sources receive `serverConfigService.url`.
- [ ] New nav screens use the `AppConstants.navXxx` index constants and keep the
      order in sync with `NavigationSidebar`.

## 2. Theme & UI

- [ ] Uses `Theme.of(context).colorScheme` or the documented Rhythm 2.0 light-theme
      tokens (`#4F6AF5` primary, `#F8F9FA` sidebar, `#E5E7EB` borders, etc.). No
      hard-coded ad-hoc colors that bypass the token set.
- [ ] Error states render through the shared `error_banner` / controller
      `errorMessage`, not silent failures.

## 3. Dual-endpoint discipline (critical)

Production (`api.vcrcapps.com`) and the local agent server (`localhost:4001`) own
separate data and must never be conflated.

- [ ] Agent data sources hard-code `AppConstants.agentLocalBaseUrl` — they are
      **never** wired to `serverConfigService.url`. Changing the Settings server
      URL must not move agent traffic.
- [ ] Feature (non-agent) data sources use `serverConfigService.url`.
- [ ] Trigger polling stays on the production path; execution stays local.
- [ ] Nothing exposes port 4001 externally or removes the `AGENT_LOCAL` auth bypass
      guard (`if (!env.agentLocal) requireAuth`).

## 4. API server / persistence

- [ ] Schema changes ship as `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE` in
      `migrations.ts`, and a **new column has an explicit Postgres backfill**, not
      just a SQLite migration (Postgres/SQLite drift is a known trap).
- [ ] Services that intentionally no-op under `dbClient === 'postgres'` keep that
      gate; don't "fix" a local-only path to run in prod.
- [ ] New endpoint = model + repository + controller + route, registered in `app.ts`,
      and reflected in the endpoint table in `CLAUDE.md`.

## 5. Correctness & safety

- [ ] No secrets, tokens, `.env` values, or internal hostnames in the diff, commit
      message, comments, or logs.
- [ ] Error handling doesn't swallow exceptions; user-facing failures surface a message.
- [ ] Nullable/edge cases handled (empty lists, missing fields, offline server).
- [ ] `better-sqlite3` / native-ABI changes note the Node version constraint.

## 6. Tests & verification

- [ ] Logic changes come with unit tests; behavioral changes are verified against a
      running server, not just compiled.
- [ ] For UI/flow changes, the relevant items in `flutter-ui-smoke-checklist.md` were
      run (or the `run-smoke-test` skill was used) and the result recorded.

## 7. Documentation & logging (project convention)

- [ ] Durable decisions logged to `docs/ai/decisions/YYYY-MM-DD-<slug>.md`.
- [ ] Session work logged to `docs/ai/runs/YYYY-MM-DD-<slug>.md`; `project-state.md`
      overwritten (never appended) if the snapshot changed.
- [ ] `CLAUDE.md` / `AGENTS.md` updated when structure, endpoints, or constraints change.

## 8. Git / PR workflow

- [ ] Work is on a feature branch; the PR is left **open** for the user to test —
      never auto-merged.
- [ ] PR body follows `.github/PULL_REQUEST_TEMPLATE.md`.
- [ ] Commit messages describe the *why*, contain no model identifiers or secrets.
