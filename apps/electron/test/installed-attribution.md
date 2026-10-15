# Installed attribution slice — BLOCKED, not package qualification

Baseline Mega `c1b7e023fbd85774fe447078cfe410f228dee539`, PR1598. Tests only.
This extends the existing packaged CDP pattern and reuses `colony-installed/run.mjs`
archive/file hashing. It does **not** replace the existing release/qualification path.

## Supported commands (repository root)

```sh
# Parsing only, safe now; no imports, runtime, or fixture access.
node --check apps/electron/test/installed-attribution.mjs
node --check apps/electron/test/installed-attribution.test.mjs

# Manager only, later: pure helper tests with manager-approved isolated HOME/TMPDIR.
node --test apps/electron/test/installed-attribution.test.mjs

# Manager only, after final rebuilt signed/stapled install and runtime release.
node apps/electron/test/installed-attribution.mjs preflight /private/tmp/<owned>/fixture.json
RHYTHM_INSTALLED_ATTRIBUTION_PROXY=owned-synthetic-only \
  node apps/electron/test/installed-attribution-proxy.mjs /private/tmp/<owned>/fixture.json
RHYTHM_INSTALLED_ATTRIBUTION_RUNTIME=manager-ready \
  node apps/electron/test/installed-attribution.mjs observe /private/tmp/<owned>/fixture.json
RHYTHM_INSTALLED_ATTRIBUTION_RUNTIME=manager-ready \
RHYTHM_INSTALLED_ATTRIBUTION_TRIGGER=owned-synthetic-only \
  node apps/electron/test/installed-attribution.mjs native-trigger /private/tmp/<owned>/fixture.json
node apps/electron/test/installed-attribution.mjs qualify /private/tmp/<owned>/fixture.json
```

All CLI modes exit **1** while native qualification is unsupported. `preflight`
checks only artifact identity; `observe` adds an attach-only two-renderer snapshot,
actual outer UI reload GET, and, when `nativeCron` is supplied, read-only
production-bridge health/job inventory corroborated by the owned loopback proxy
receipt. `native-trigger` is a separate, explicit synthetic-only gate that clicks
the installed UI after hashing the harmless script copy, observes one backend
POST and durable run, and checks pending, duplicate suppression and reopen.
`qualify` remains an explicit `UNVERIFIED` red gate for unrun cases. A helper
test pass never changes that gate.
No case is promoted merely from a supplied result map. Missing cases stay `not-run`.

## Exact manager prerequisites

Do not launch now: A `childf64a2052` owns4098/4097/4099. Manager must release those
and explicitly assign the runtime, paths and PIDs before enabling `observe`.
The attach-only diagnostic has no lifecycle commands. The separate proxy
process is manager-owned. Manager alone prepares/launches the
existing non-owning interactive path, once readiness is established:

```sh
# Values are assigned by manager; not defaults or authority to adopt existing paths.
HOME=<owned-synthetic-home> TMPDIR=<owned-temp> \
HERMES_HOME=<owned-synthetic-hermes-root> \
RHYTHM_SHELL_USER_DATA=<owned-synthetic-profile> \
RHYTHM_LIVE_API_URL=<owned-api-base> RHYTHM_LIVE_ENGINE_URL=<owned-engine-base> \
RHYTHM_PRODUCTION_API_URL=<owned-synthetic-api-base> \
  "<final-installed.app>/Contents/MacOS/Rhythm" \
  --interactive-smoke --allow-test-runtime-ports \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=0
```

Manager must use the documented isolated environment/credential boundaries; do
not inherit live HOME, auth, Hermes config, API, provider, or subprocess defaults.
The above is a launch shape, not an executed command. The Hermes root must be
an **isolated copy** under the owned temp root. Its `hermes-agent` payload and
`hermes-agent/venv` must come from the pinned companion artifact at
`d747cbd9e81870704347738cb702d3f229818557`; verify those bytes against
the installed manifest before launch. The installed app may spawn its own
local backend for the shell. The **test connection** instead targets a separate
manager-owned pinned backend through an owned loopback proxy. Launch that
backend only after assigning isolated paths and a free port:

```sh
# Shape only: manager supplies fresh paths, port and synthetic token environment.
HOME=<owned-home> HERMES_HOME=<owned-hermes-root> \
  <owned-hermes-root>/hermes-agent/venv/bin/python -m hermes_cli.main \
  --profile <synthetic-profile> serve --host 127.0.0.1 --port <backend-port>
```

Provision the script-only job in this backend, start the test-only proxy in a
separate manager-owned terminal using the proxy command above, and record its
printed PID in the fixture. Add a **new
synthetic** remote-shaped connection in the isolated installed userData pointing
to `proxyBase` with the backend's synthetic token and record its ID. The
existing operational registry is never changed. The proxy forwards only
health/status, this job's inventory/runs/trigger, and bounded `/api/ws` traffic
to `backendBase`; it logs method, route, synthetic job ID or health marker,
and actual upstream status, never auth/body. Its byte/time limits are in source.

Fixture JSON must reside in an approved external `/private/tmp` or `/var/folders`
directory. Provide these keys (no tokens, capabilities, private keys, or payloads):

- `kind: "synthetic-installed-attribution-v1"`, `managerReady: true`, `syntheticOnly: true`.
- `appPath`: **new final installed signed candidate**, not current invalid Mega install.
- `zipPath`, `expectedSha256`: exact qualification archive and manifest SHA-256.
- `artifactsDir`, `userData`: existing distinct external owned temp directories.
- `hermesPin`: actual frozen companion commit from reviewed package manifest.
- `fileSha256`: Resource-relative file → expected SHA-256. Must include
  `app/src/main.mjs`, `hermes-desktop/electron/embedded-host.mjs`,
  `hermes-desktop/install-stamp.json`, and both renderer JavaScript assets.
- `rendererAssets`: `[{url, resourcePath, sha256}, ...]` for outer and embedded
  entry assets. These are **SHA-256**, not the handoff's Git-blob hashes. CDP hashes
  loaded JavaScript and compares it with installed file hashes. No source is saved.
- `appPid`, `apiPid`, `enginePid`, `apiBase`, `engineBase`, `cdpEndpoint`: actual
  manager-owned identities. App executable/flags, CDP listener/profile endpoint,
  API/engine PID listeners and outer gateway are checked before reloading.
- `syntheticApprovalIds`: only owned synthetic approval IDs for metadata filtering.
- Optional `nativeCron`: `{profile,connectionId,jobId,jobName,backendBase,
  backendPid,backendVersion,proxyBase,proxyPid,proxyReceiptLog,profileHome}`.
  The profile must be
  `attribution-20261001-<fresh UUID>` and the name the same suffix prefixed
  `rhythm-native-attribution-`; `jobId` is the 12-hex ID returned by the owned
  backend. `connectionId` must be `native-attribution-<same UUID>` and point
  to `proxyBase` in the isolated registry. Both `backendBase` and `proxyBase`
  are distinct loopback ports other than 4001/4096/4097/4098, with checked
  listener PIDs. `proxyReceiptLog` is an existing empty file under the owned
  external temp root; `profileHome` is the isolated
  `HERMES_HOME/profiles/<profile>`. The harness never records prompts or auth.

The manager can prepare the unique job in the isolated Hermes profile with
the backend's supported `POST /api/cron/jobs?profile=<profile>` route. Copy
`fixtures/native-cron-silent.sh` into that profile's `scripts/` directory,
make that copy executable, and use `name: rhythm-native-attribution-<same UUID>`,
`schedule: "0 0 1 1 *"`, `deliver: "local"`, `no_agent: true`,
`script: "native-cron-silent.sh"`, `prompt: ""`. Retain the returned job ID
and read-only `/api/health` version in the fixture. This is a local script-only
job; it cannot call an optimizer or model. Provisioning/launch must happen
only in the manager-owned isolated backend and is not performed by this harness.
The copied script sleeps five seconds to expose the pending UI and prints one
local-only synthetic line. The trigger mode compares its SHA-256 to the
checked-in script before any click; a changed script fails closed.
Set the installed Hermes active profile to this exact synthetic profile in the
owned profile before `observe`; the harness reads `hermes:profile:get` and fails
if it differs. Keep the synthetic UI locale English for its `Trigger now`,
`Close cron`, `Cron`, and `Run history` locators. Do not substitute a remote
connection or an existing user profile.

Use real worktree dependencies, not symlinks into main. After manager permission,
provision `apps/web`'s existing locked Playwright dependencies in this worktree
using the established dependency recipe; this author did not install anything.
CDP needs no new browser download. Hardened package may refuse attachment: that
is BLOCKED, not permission to disable fuses/signing or substitute dev Electron.

Factory-only observation is intentionally bounded: if an installed update/dev
artifact is active, fail rather than fingerprint the factory and call it active.
CDP target/frame IDs are emitted as such; they are never called WebContents IDs.
Frame role is determined by the actual URL, not the selected outer navigation tab.

## What the diagnostic can and cannot establish

Outer reload executes the existing UI's native-authenticated human GET. Capture
method/path, redacted origin, status, auth **presence only**, failure category, and
allowlisted synthetic metadata.403/503/transport/non-array failures are retained;
no failed GET is normalized into an empty-success queue. Observe a genuinely failed
GET to investigate reload-resistant absence. A successful reload GET proves only
that GET, not mount/focus/new-creation freshness or global card visibility.

The two reported IDs `27db624a-0bb2-4fc7-a177-8988dec76dbe` and
`879da510-2ae4-4ee3-b43a-7097b2a73c70` are **not queried** by this synthetic harness.
They remain pending/unverified. Only a separately authorized supported native
human-read operation may report their `{id,status,sessionId,lane,createdAt,expiresAt}`.
Do not copy live auth or query DB/MCP/unrelated rows to fill this gap.

No approval decision is sent. Legitimate approve/reject must be a real human
gesture through the existing outer nonce-bound native signer/auth. No fallback
browser-key enrollment, manufactured capability/decision/private key, or Hermes
signer is supported. Hermes permissions are `approval.pending/received/respond`
engine RPCs, not Rhythm signed pending cards.

## Native proof seam and next step

Pinned `d747cbd9e81870704347738cb702d3f229818557` cron API **does** expose
`createCronJob` → POST `/api/cron/jobs`; do not claim synthetic creation is absent.
The pinned backend supports a `no_agent` script-only job, and the fixture above
uses that path. Do not import live config or fire an optimizer.

Production transport is `window.hermesDesktop.api` → `hermes:api` →
`handleHermesApiRequest` in companion `apps/desktop/electron/desktop-native-runtime.ts`
(pin lines13906–14057), selected by embedded host `registerCoreBridge:false`.
The main-process HTTP request is not renderer CDP traffic. The test bridge's
`proxyApiRequest` fallback is **not** this path. `observe` now sends one read-only
`/api/health?rhythm_attribution=<nonce>` through the installed `hermes:api` bridge
and requires the exact nonce and actual upstream 200 in the owned proxy receipt. It checks
the returned version and the uniquely named script-only job inventory. This
proves the owned backend answered that bridge read; it does **not** prove a
native trigger click or its response. Frozen contextBridge must not be
monkeypatched to fake a receipt.

The trigger mode retains that owned proxy receipt and reads the durable run ledger
through `GET /api/cron/jobs/:id/runs?limit=20`. It selects the exact job row
`data-panel-row=<jobId>`, clicks the detail header's real “Trigger now” once,
requires the button disabled while pending, observes exactly one upstream HTTP
200 POST in the proxy receipt, requires a new terminal `cron_<jobId>_...` session and the
rendered run history, then closes and reopens the Cron panel through its own
UI. It never supplies a fake backend response or calls the trigger bridge
directly. If proxy attribution
cannot safely bind the trigger's status to the owned backend, the smallest
fallback is an opt-in metadata-only receipt at the production
`handleHermesApiRequest` boundary, outside Resources, with no auth/body. That
would require companion ownership, impact review and repin.

The authored native click path remains unrun until the final package, isolated
fixture and manager runtime release are available. Outer
`/agent-schedules/:id/trigger-now` cannot close that Hermes case.
No attribution to AJ's “Org Optimize” action is possible without its own receipt.

## Required unrun acceptance (red gate, not manual pass)

- Global outer pending cards with null session and matching session; bound-only
  Transcript behavior must not hide global cards.
- Fetch on mount, **real** focus, new synthetic creation, and reload; actionable
  failed GET/auth/non-array errors (do not inject fake focus or mock responses).
- Native request/version/durable result/pending/error/dedupe/reopen described above.
- Human-gesture nonce-bound signer check, only after human operator permission.
- Supported metadata-only read for the two reported IDs, if safely authorized.

All are explicitly `not-run` in receipts and the qualification command fails.
No computer-control fallback was used. If genuine native signing requires a human,
record the click, expected nonce-bound outcome and sanitized receipt externally;
never automate a signing gesture. Convert non-signing native checks to deterministic
Playwright after the missing owned fixture/receipt exists.
