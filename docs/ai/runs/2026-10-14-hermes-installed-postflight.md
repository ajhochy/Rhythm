---
date: 2026-10-14
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: 1616
issues: [NOTIFY-HERMES]
status: INSTALLED_ACTIVATION_NOTRUN_RECEIPT_RETENTION_GAP
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Actual install / postflight — activation NOTRUN

## Files changed / scope

Docs-only parent handoff at `bb4a5651addbffc73a9ad47279196c783ba0cc4a`:
targeted notify checkpoint in `docs/ai/project-state.md` and this new receipt only.
Loaded project-state-updater; read nearest staging, launcher optimization,
current-identity, failed lockrepair and subsequent real-ACK readiness receipts.
Historical receipts, parent-owned launcher/tests/staging notes, raw diagnostics,
copied source and other agents' artifacts are preserved. No tests, servers, SSH,
live configuration reads, source edits, Git mutations, commit or push here.
The execution/postflight facts below are the supplied parent/manual checkpoint,
not a new host observation by this documentation writer.

## Checks / actual execution evidence

### Approval and independent prelaunch qualification

AJ's exact prior conditional approval covered installing the TESTED WebUI with
ONE planned restart of the SAME container/image/config through an independent
host job. The latest approval covered exactly eight chmod operations, not a new
restart grant. Parent applied only four directories to0755 and four files to0644;
owner1000 preserved. Before/rollback permission record remains at
`/private/tmp/rhythm-pi-permissions-1791993978313648000` (not read here).
No additional permission change occurred.

Parent gh observed all3 CI green at bb4a5651. Original launcher qualification
failed because optimization removed assertions; [repair](2026-10-14-hermes-launcher-optimization-repair.md)
replaced them with explicit guards. Independent launcher verifier `27ca` then
PASS: all35 predicates identical,222 optimized denials with zero writes. Protected
stage16 remained0700 directories/0600 files, hash-verified with current seven-output
source-gate provenance. Parent fresh prelaunch pin/preflight PASS preceded launch.
The [staging](2026-10-14-hermes-host-staging-preflight.md) and repair notes retain
their historical NOTRUN/HOLD states; this receipt supersedes those states, not history.

### Actual command — already executed by parent; DO NOT REPLAY

Fixed user systemd unit, service-type exec, Restart=no, UMask0077, protected stage:

```sh
/usr/bin/systemd-run --user --unit=rhythm-notify-install-bb4a5651 --service-type=exec --property=Restart=no --property=UMask=0077 --working-directory=/home/pi-nas/rhythm-notify-stage-bb4a5651 --setenv=PYTHONPATH=/home/pi-nas/rhythm-notify-stage-bb4a5651 /usr/bin/python3 -B /home/pi-nas/rhythm-notify-stage-bb4a5651/launcher.py --execute-parent-authorized --reviewed-candidate-sha 345f06d30d645936a5a01442045e92814290a9a15bce8f8f56ee975c044f1822 --independent-gate-reviewed f92b7221e403f350f98526965a72dbd863d68ea4e71bf76de908e438f6db7919
```

Parent recorded launchExit0 and invocation `ad9a190fb59f4d70a0114b2601f1270f`.
Reviewed launcher SHA256:
`76962c3c72615ca5be5cefc6f5a023d2c71f598129ce12f5c8437435ceb2f0a2`.
Actual ONE restart consumed; no recreate, second restart, restore or merge:

| Postflight identity | Observed value |
|---|---|
| Same container | `8b5fa0a02828be30446501025a4ffdfbb6a9462a32e8da9cc5b706e874395eec` |
| Same image | `sha256:4fbb112fb9f90efac654c43239cffc233122c2b7536aaad9de1e88455c20de0a` |
| Same configDigest | `f32cd63ffaf5bb29ed3e3d32a634f49673e0a08cc8e141cad17964c049f3d99b` |
| StartedAt | `2026-10-14T16:42:17.085810215Z` |
| Runtime / mount | running, healthy; same read-only `/webui` mount |
| Executed manifest SHA256 | `dd8c6ac215a723713b2b5207d53af06053ecb07871232f56a59003a7d098001f` |
| Persisted restart-intent SHA256 | `85b2e1b990db12d658547f11609a13eaa450e725cacb6eece4cbba2b832d3125` |

Executed manifest differs from candidate ONLY by `launchedOnHost=true`.
Protected stage backup now exists with four originals, original metadata and
restart intent; three CREATE targets' prior absence is preserved in the record.
Existing backup/restart intent blocks replay. Never remove markers or rerun to
recover a missing receipt. Runtime rollback requiring restart2 needs separate
explicit AJ approval; source restoration alone would not prove runtime rollback.

### Independent postflight and bounded preservation follow-up

Independent `4aff`: **installed ARTIFACTS + HEALTH PASS**. All7 installed after-hashes
match the current reviewed table in [current identity](2026-10-13-hermes-current-identity-reconciliation.md),
all0644, regular/single-link, owner1000; staged16/provenance/config/health verified.

Full preservation gate initially **BLOCKED**, not PASS: hardened reader rejected
group-writable parents for four vendor files. Parent then performed bounded
READ-ONLY no-follow identity/hash checks; all four match original pins:

| Original vendor path | SHA256 |
|---|---|
| `static/vendor/js-yaml/4.1.0/js-yaml.min.js` | `45dc3dd03dc07a06705a2c2989b8c7f709013f04bd5386e3279d4e447f07ebd7` |
| KaTeX0.16.22 CSS | `19095127357ed6d29fe0a63a6b000c913a89f7f1963b765dd3715e97c9852e75` |
| KaTeX0.16.22 JS | `e8d885505949f3a5f4abdd5dd0d53696bd1371ad26ffbf4f310dcd77c8cdae89` |
| smd | `20c0a39e6ec48b99e2f505f8488d2342fb3000d03523a7ced6cd94c14b15e8c5` |

All four regular/single-link0664 owner1000; vendor/sublibrary parents0775 unchanged
and NOT approved chmod targets. Combined original107 coverage =4 expected
replacements +99 independently unchanged +4 parent-verified unchanged vendor files.
This closes missing byte evidence only; it is NOT an independent full preservation
gate PASS, installer permission-guard relaxation or additional chmod authorization.

### Receipt retention limit

Host unit later unloaded (`LoadState=not-found`); user journal query for the fixed
unit returned0 entries. **No unique printed installer completion JSON is retained.**
Early parent `Result=success` unit-show is not durable proof; launch response above
is parent-recorded and not independently recoverable. Exact installed bytes,
backups/executed manifest/persisted restart intent and new StartedAt with unchanged
config/healthy runtime establish actual deployment, not a retained service-complete
JSON receipt. Future procedure should retain that receipt durably; no automatic
rerun is authorized and replay protection remains intact.

## Notes / qualified boundary / next operator step

- Independent native fixture verifier `4f0` PASS: actual real Rhythm SSE + NativeAdapter
  + copied deployed HTTP + deterministic TEST provider setup + unobscured Chromium
  exact-visible render + actual sandbox API ACK. RealACK1, native30 and migration11
  PASS; provider1, wrong-run404, retry/tombstone2, foreign workflows unchanged.
  See [readiness](2026-10-13-hermes-realack-readiness.md) for commands and the
  [current-identity](2026-10-13-hermes-current-identity-reconciliation.md) receipt for
  parent-provided independent qualification. Earlier failed lockrepair remains
  historical; fixture readiness synchronization was test-only, not product easing.
- This is NOT actual Pi private-relay/live AJ-session delivery, production-provider,
  daily-user or physical mobile smoke. Production activation remains **NOTRUN**:
  registry/conversation not linked, subscriber not running, no new protected
  credential reference provisioned, no chat notifications/native API live calls
  or real cards. Installed adapter is not activated delivery.
- Draft #1616 remains bb4a5651 with parent-owned launcher/docs follow-up commit
  pending. Approval draft #1615 remains `8dd967a8`, all4 CI green, undeployed;
  actual real-chat approval unexercised. No merge authorized.
- Next narrow operator step: supply fixture conversation/profile/immutable owner/run
  link and protected existing-token reference; then temporary subscriber using
  existing relay4001 for real Pi visible/ACK smoke, without another restart or
  adopting the current chat. Do not invent operator values. Refer to
  [INTEGRATION](../../../tools/dev/hermes_webui_receiver/INTEGRATION.md) and the
  current parent operator handoff for deployed-adapter
  process/ownership, existing credential-reference policy, no extra login and LAN
  boundary. INTEGRATION's historical NOTRUN text is not current installation evidence;
  this receipt controls the install status only.

Documentation validation: read-only `git diff --check`, targeted snapshot diff and
numstat, plus untracked receipt whitespace/diff review; no behavioral checks rerun.
