# Hermes B1: Finish and prove the unified Rhythm plugin for Hermes

## Goal

Finish the existing Rhythm-inside-Hermes feature pack, preserving the read-only first slice from plan §4 and the release/parity gates from §20. Keep the shared Electron consumer functional; this direction coexists with B3's Hermes-inside-Rhythm tab and does not authorize a host cutover.

## Plan

- [Hermes Rhythm feature-pack plan](https://github.com/ajhochy/hermes-rhythm-plugin/blob/plan/rhythm-feature-pack/.hermes/plans/2026-08-20-hermes-rhythm-feature-pack.md): §§4, 5, 7, 18–20; M4.6 and M9.2–M9.3.
- [docs/dev-plans/hermes-port-plan.md](https://github.com/ajhochy/Rhythm/blob/mega/2026-09-18-mobile-electron-hermes/docs/dev-plans/hermes-port-plan.md): sidecar context only; its later default flip/retirement is outside this campaign.

## Dependencies

- Existing Rhythm branch `hermes/rhythm-workspace-ui-integration` and fork branch `wt/t_c118913c`; reconcile the brief's 113-commit Rhythm drift against `mega/2026-09-18-mobile-electron-hermes`.
- Fork issues `ajhochy/hermes-rhythm-plugin#3–#14`, including generic SDK/reload seams and the M4.6 workspace-authority/write-readiness gate. B2–B4 are not prerequisites for this direction.

## Likely files

- Rhythm: `packages/rhythm-workspace-ui/` restored from the integration branch, its contract/React-host tests, and `apps/web/src/` host adapters and package consumer.
- Fork: `plugins/rhythm/{plugin.yaml,dashboard/,desktop/,skills/}`, `contracts/rhythm/`, and generic plugin loader/package-data seams only where required by the plan.
- Fork: `plugins/rhythm/desktop/scripts/build-runtime-plugin.mjs`; regression suites under `tests/plugins/rhythm/`; reproducibility, doctor and lifecycle fixtures.
- Campaign evidence/run logs and the approved-module parity matrix in the respective repositories.

## Requirements

- Rebase the Rhythm integration onto the mega branch, resolve drift without losing current host behavior, and keep the shared package buildable on React 18.3 and 19.2 with peer runtimes only.
- Push `wt/t_c118913c`, rebase it onto fork `main`, rebuild the unified package and reinstall into `~/.hermes/plugins/rhythm`; preserve credentials/preferences and document rollback.
- Meet M9.2: one desktop ESM bundle with no relative JS chunks, externalizing only `@hermes/plugin-sdk`, `react`, `react/jsx-runtime`, `react/jsx-dev-runtime`; no second React or source-map credential capture. Include deterministic hashes, source/version provenance, licenses and disposable CSS.
- Use a backend-owned, schema-validated semantic operation allowlist. Validate `/auth/me` and `/workspaces/me`, remove `joinCode` and other sensitive fields, and pin profile-stable routing to the designated local backend.
- Prove Dashboard, Tasks and draft-only Ask Hermes against `https://api.vcrcapps.com` with no Rhythm local-agent dependency; keep this read-only gate separate from write-enabled tests.
- Enable task completion/rescheduling only after M4.6 authorization, conflict, idempotency/reconciliation and read-back gates. Expose exactly the three approved Hermes-native tools using Hermes approval policy, never legacy Rhythm approval IDs.
- Retain §20 parity for all nine approved non-agent modules and shared artifacts; record unsupported/deferred flows honestly and do not label the campaign complete while a required gate is open.

## Acceptance criteria

- [ ] **HRM-B1-AC1:** The rebased shared package builds and its React 18.3/19.2 host contracts pass; bundle inspection finds no bundled React, and the existing Electron consumer still renders its supported non-agent screens.
- [ ] **HRM-B1-AC2:** Fork-integrated builds/package checks pass; the unified artifact meets M9.2, including byte-for-byte `write:false` rebuild comparison, hashes, provenance, licenses and secret/source-map scans.
- [ ] **HRM-B1-AC3:** The installed package passes install → enable → reload → disable → uninstall, plus update/rollback; `hermes doctor` and `hermes plugins doctor` pass without exposing secrets or leaving duplicate routes, styles or listeners.
- [ ] **HRM-B1-AC4:** One Rhythm sidebar destination renders safe identity/workspace metadata plus real Dashboard and task-list data from `https://api.vcrcapps.com`; network assertions find zero hosted POST/PATCH/PUT/DELETE requests in this read-only slice and zero calls to port 4001.
- [ ] **HRM-B1-AC5:** Ask Hermes about this opens a native, editable chat draft with entity ID and bounded context labelled as untrusted user-authored data; it never sends, creates a Rhythm agent session or exposes a credential.
- [ ] **HRM-B1-AC6:** `rhythm_get_dashboard`, `rhythm_list_tasks` and `rhythm_complete_task` pass live Hermes policy tests; denied/unapproved completion makes zero writes, approved completion has live read-back, and M4.6 complete/reschedule tests prove unauthorized targets, conflicts and ambiguous retries cannot yield duplicate writes or false success.
- [ ] **HRM-B1-AC7:** Profile switches, restart, plugin reload, offline/reconnect and auth expiry recover correctly; renderer state/storage/responses, query keys, URLs, logs, bundles and model/tool context contain no credentials, and workspace metadata contains no `joinCode`.
- [ ] **HRM-B1-AC8:** The approved-module matrix records parity evidence for Dashboard, Planner, Tasks, Rhythms, Projects, Messages, Facilities, Automations, Integrations and shared artifacts; no duplicate Rhythm Agents/Profile/Model/Skill/Schedule/Delegation surface ships, and responsive, keyboard, theme and WCAG 2.1 AA gates pass.
- [ ] **HRM-B1-AC9:** A draft fork PR targets `ajhochy/hermes-rhythm-plugin:main`; every fork issue #3–#14 has criterion-level evidence and closes only when proven. Dedicated campaign tracker/run logs are accurate, approved Obsidian dry-run updates are recorded, and AJ's merge/cutover gate remains explicitly separate from technical verification.

## Required tests / evaluation

- Run shared-package builds and both React-host contract suites; add host regression/rendered specs in `apps/web/tests/` using neighbouring fixture-mode patterns.
- Put fork plugin coverage under `tests/plugins/rhythm/`; exercise semantic allowlisting, redaction, profile routing, auth expiry, CSS disposal, lifecycle/doctor and reproducible packaging.
- Capture real Hermes installed-app evidence against `https://api.vcrcapps.com` only. Record read-only network assertions separately from explicitly approved task-write/read-back runs using designated test tasks.
- Falsify no-auto-send and write-denial guards to prove the assertions detect unintended sends/writes; record commands, SHAs, outputs and redacted evidence for each gate.

## Safety and scope

No renderer-held credentials; no second agent runtime bound to `localhost:4001`; no arbitrary proxy to the Rhythm API; OpenCode remains the default engine in Rhythm. Keep secrets backend-owned with no manual renderer credential form. No external messages, Gmail/Calendar writes, membership writes or unapproved Planning Center effects; no blanket ACP approval. Hosted checks use only `https://api.vcrcapps.com`, and writes require the separate M4.6/approval gate. Keep Rhythm-specific code inside the feature pack and reuse UI source from the shared package. No production service takeover, automatic cutover, direct-to-main commits or automatic merge; preserve the Electron consumer until a separately approved cutover.
