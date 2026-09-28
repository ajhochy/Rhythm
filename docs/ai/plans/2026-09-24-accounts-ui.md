# #1569 Accounts UI boundary

Accepted Electron products remain frozen. This is acceptance-only; implementation follows parent review. Original 28 acceptance criteria remain authoritative, including s4-c1. This supplement covers metadata needed for honest UI plus the existing Accounts inspector only.

## Design and composition

Use Impeccable Operate mode with incumbent AgentSettingsTool.css, shared ListInspector and existing buttons/semantic text. This is a scoped extension, not a redesign; no new product interview or visual system is needed under the user's existing direction. Keep Accounts selection inert on the left. Add one named `Hermes account sharing` region inside Accounts, composed by both LiveSettingsTool and FixtureAgentSettingsTool. Existing OpenCode account management stays unchanged. Provider groups are named OpenAI, Anthropic, Google and OpenRouter. No credential inputs, OAuth login/editing, paths or raw IPC payloads in this region. Do not add a second account store.

Each group separates source presence from grant/application status. Plain labels: `Configured for next start`, `Applied to running Hermes`, `Pending next start`; when disabled with a retained child key, explain that running Hermes may retain it until stopped. A Hermes-owned source takes precedence, without claiming it is authenticated or its token valid. OAuth is not shareable. Missing sources stay absent; malformed/unreadable/future schemas stay unknown. Memory sharing remains explicitly disabled. Desktop-unavailable state removes actions and does not retain previous identity's applied/grant display.

Enable/disable submits exactly `{ action, provider, source: 'opencode-auth-json' }` through aiAccounts. Main owns the one native confirmation. While waiting, disable duplicate submission and keep prior state. `accepted:false` says no change. `accepted:true` triggers a fresh metadata read; never locally invent applied. Include Refresh sharing status and loading/error states. No key values or fingerprints appear in DOM, debug output, browser storage, API requests or trace fields.

## Additive metadata contract

Current `sourceState` is ambiguous: configured can mean native-only or Rhythm static. Preserve it for compatibility, and add per-provider:

- `rhythmSourceState`: `static-api-key | oauth | absent | unknown`.
- `hermesSourceState`: `present | absent | unknown`. Present is ownership evidence only, from recognized .env names or supported auth provider-name presence, never token inspection.
- `sharingEligibility`: `eligible | hermes-owned | oauth-not-shareable | source-missing | source-unavailable`.

Precedence: known native presence => hermes-owned; otherwise unknown native/readiness or unknown Rhythm source => source-unavailable; otherwise static Rhythm key => eligible; OAuth => oauth-not-shareable; absent => source-missing. A static key must satisfy the same 1..4096 length and control-character rejection as S3's validEnvValue. Do not inspect OAuth contents. Whole-file sources retain malformed/unreadable/unknown distinctions already provided by S1. A saved grant with removed source remains grantEnabled/configured as a reference but is source-missing, not eligible. Disable remains available for an existing grant even when its source becomes unavailable; enabling requires eligible.

## Ownership

After review only: S1 hermes-accounts.mjs metadata derivation; hermes-accounts-main.mjs projection; ai-accounts.d.ts extension; focused tests/package registration. UI owner: AgentSettingsTool.tsx Accounts render sites, small aiAccountsBridge.ts/component if needed, incumbent CSS additions only as needed. Do not change other settings sections or #1560–64. No foreign/native store writes.

## Tests and boundaries

- `node --test apps/electron/test/hermes-accounts-eligibility-contract.test.mjs`: 13 expected RED missing enum metadata; uses actual adapter and synthetic descriptor-safe files. Cases include native-only env, auth presence, malformed/future schema, oversized unreadable env, OAuth, missing source, newline/NUL values and retained grant after source removal.
- `cd apps/web && npx playwright test --config tests/agent-settings-hermes-accounts.config.ts`: rendered actual live+fixture AgentSettingsTool and real GatewayProvider with a minimal frame. The real main adapter generates fixture DTOs; only gateway/IPC external boundaries are synthetic. esbuild bundles actual components into an in-memory browser page; no web/API/engine server. Existing Accounts selection is a passing harness prerequisite; missing new sharing region/actions is meaningful RED. Styles are omitted in this behavioral contract, so this is not visual/a11y layout qualification.
- Logs `/private/tmp/rhythm-accounts-eligibility-red.log` and `/private/tmp/rhythm-accounts-ui-red.log`.
- After implementation: targeted rendered contract, metadata/S1/S2/helper tests, Electron/web typecheck, existing Accounts ListInspector regressions. One bounded desktop+narrow visual/accessibility pass remains required with actual CSS; native confirmation already covered by actual-main contract, packaged/native aggregate remains parent-owned.
