# Rhythm — Project State

## Current focus

Main now carries four merged PRs, in order: #1494 (prior baseline), #1493 (iOS hosted sign-in), #1495 (Electron replacement candidate, Phases 1–5), #1492 (Org Reviewer). AJ explicitly instructed merging #1493/#1495/#1492 ahead of their manual smoke on 2026-09-16. Current `main`: `8e2f3f6bf1487929f83220bb22cb26562c5b8d02` (merge order: iOS squash `23a8c618` → Electron squash `c27a3f6c` → Org Reviewer squash `8e2f3f6b`).

The API image was published to GHCR from `8e2f3f6b` (API Image Publish workflow run [35126185122](https://github.com/ajhochy/Rhythm/actions/runs/35126185122), SUCCESS). `https://api.vcrcapps.com/health` reported `c27a3f6c` at last check — Watchtower deploys `:main` automatically within ~30 minutes, so hosted state may already be ahead of that.

Desktop **v0.18.64** (prerelease, signed and notarized) was released from `fc5695ee` at 2026-09-16T20:00Z — [run 35141645718](https://github.com/ajhochy/Rhythm/actions/runs/35141645718), smoke/sign/publish all green — after four release-pipeline fixes for expectations #1492 left stale: #1498 (smoke seed assertion → Org Reviewer contract), #1499 (parity test pinned the retired profile ID), #1501 (managed-skills root, superseded), #1502 (drop `NODE_ENV=test` from the bundled-server smoke so it boots like the Flutter launcher; the opencode agent writer skips profile writes in test mode, so the reviewer seed could never complete there). An earlier attempt (run 35127366576) failed at that smoke.

## Active branch / PR

- `main` — SHA `b804842a2be70b6d7b8c5fffa2ed1dabcd99bcd4` (#1504 Node 24.18.1 image pin on top of `8e2f3f6b`).
- This docs PR (`docs/2026-09-16-main-catchup-release`) records the catch-up; no product code changes.
- Merged: [#1493](https://github.com/ajhochy/Rhythm/pull/1493) iOS hosted sign-in (squash `23a8c618`), [#1495](https://github.com/ajhochy/Rhythm/pull/1495) Electron replacement candidate Phases 1–5 (squash `c27a3f6c`), [#1492](https://github.com/ajhochy/Rhythm/pull/1492) Org Reviewer (squash `8e2f3f6b`).
- Full detail: [run log](runs/2026-09-16-main-catchup-release.md).

## In progress

AJ's manual smoke of the three merged features, plus fixing the desktop release:

- **iOS (#1493):** deploy to hosted API/relay with rollback preserved; verify real Google login through Cloudflare/Synology in iOS Simulator; inspect existing chats read-only and send once in a designated test conversation only; verify VoiceOver, contrast, keyboard, reconnect, and measured native responsiveness. PR notes live acceptance was BLOCKED as of its last update (hosted API on stale `9c027b52`, relay `macOnline:false`, desktop API on 4001 down) pending the NAS relay recreate + Rhythm.app relaunch below.
- **Electron (#1495):** Planner (native zoom, themes, forced colors, reduced motion, keyboard, backlog, drag, sticky action, density); Dashboard (ordering, dates, collisions, legacy-fixture diagnostic disposition, themes, zoom, forced colors, VoiceOver, narrow artifacts); Tasks (installed visuals, VoiceOver); real provider/session behavior; signed dual-architecture packaging; broader retirement gates. `apps/electron` + `apps/web` remain a prototype — Flutter (`apps/desktop_flutter`) is still the shipping client.
- **Org Reviewer (#1492):** [`docs/testing/org-reviewer-manual-smoke.md`](../testing/org-reviewer-manual-smoke.md), using isolated API 4098 / engine 4097.
- **Ops follow-up (not yet performed):** NAS relay recreate — `cd /volume1/docker/Rhythm/api_server && sudo docker compose -f docker-compose.synology.yml --env-file .env.production pull && sudo docker compose -f docker-compose.synology.yml --env-file .env.production up -d rhythm-relay` (Watchtower alone won't apply `RHYTHM_RELAY_PUBLIC_URL` from `.env.relay`) — then relaunch Rhythm.app so its local API on 4001 restores the Mac relay uplink. Verify `https://api.vcrcapps.com/health` matches the intended commit and `.../relay/health` is `ok`.

## Risks / known issues

- The hosted relay crash-looped on Node 24.21.0 + better-sqlite3 12.8.0 from 20:45Z until the #1504 image landed on the NAS at 22:21Z; any floating `node:24` tag will re-trigger it while better-sqlite3 < 13 is installed (#1505).
- v0.18.64 is a prerelease shipped without manual smoke of #1493/#1495/#1492; the installed app (0.18.63) still needs upgrading.
- All three feature merges landed ahead of manual smoke, per AJ's explicit 2026-09-16 instruction — none of the above has been visually verified in the shipping app yet.
- Watchtower auto-deploys `:main` to the hosted API within ~30 minutes of an image publish; hosted state can outrun what has actually been smoke-tested.
- Electron/`apps/web` is a prototype only, not the shipping client, per this repo's `CLAUDE.md`.
- Shared `AgentRunner` upstream impact from the Org Reviewer change was flagged HIGH by its own impact analysis; the behavior change is restricted to the reviewer path and ordinary-agent regressions passed.

## Test status

- CI green on each of the three feature merge commits before squash (`gh pr checks`, all pass, first attempt — no reruns needed on any of the three).
- API Image Publish (GHCR) for `8e2f3f6b`: SUCCESS (run 35126185122).
- Desktop release v0.18.64 (run 35141645718): SUCCESS — bundled-server smoke, sign/notarize, publish green; assets `Rhythm-macOS.dmg`, `Rhythm-macOS.zip`. Earlier runs 35127366576 / 35130646776 / 35133775547 / 35136016441 failed on the stale #1492 expectations listed above.

## Next step

Relay crash loop resolved: #1504 (`b804842a`) is deployed, `rhythm-relay` runs Node 24.18.1 with zero restarts since 22:21Z. Resume: iOS designated-conversation send test, reconnect and VoiceOver passes; the Xcode TestFlight build (on hold per AJ, prepared checkout at `/private/tmp/rhythm-ios-testflight`); manual smoke of #1495 and #1492; event-loop stalls (#1503); better-sqlite3 13 upgrade so no floating Node tag can re-trigger this (#1505).
