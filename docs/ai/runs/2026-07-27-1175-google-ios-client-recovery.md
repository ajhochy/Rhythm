---
date: 2026-07-27
repo: Rhythm
branch: codex/mobile-1172-agents-activity
pr: 1165
issues: [1175, 1198, 1199]
status: partial
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Google iOS client recovery

## Files changed

- Updated the canonical project snapshot.
- No source, native project, dependency, generated runtime, or credential file
  was added to the repository.

## Checks run

- Created a dedicated Google iOS OAuth development client for bundle
  `org.visaliacrc.rhythm.agents.dev` in the existing Rhythm Google Cloud
  project.
- Stored an owner-readable-only canonical plist outside the repository and
  validated its client-ID form, reverse-client relationship, and bundle ID
  without printing a credential value.
- Rebuilt the development-variant Release app with an embedded Metro bundle and
  the OAuth client/redirect supplied only through the build environment.
- Confirmed the embedded bundle contains the configured client and redirect
  without printing either value.
- Detected that the stale local prebuilt native project omitted the reverse URL
  scheme, added the scheme only to the built artifact, and re-signed it with
  the certificate carried by its provisioning profile.
- `codesign --verify --deep --strict` passed; the bundle identifier, callback
  scheme, and signing identity were present.
- Installed and launched the rebuilt app on the connected physical iPhone.
- `ai-workflow checks --level issue` passed Flutter analyze/format and API/MCP
  TypeScript checks.
- `ai-workflow checks --level pr` passed the complete Flutter, API, MCP,
  vendored-engine, mobile static/contract, fake-server, and web-E2E matrix on
  the final rerun.
- GitNexus classified the evidence-only working scope LOW with no affected
  process; `git diff --check` and the targeted credential/device leak scan
  passed.

## Notes

- This resolves the missing-client configuration blocker for the local
  development artifact. The physical Google sign-in interaction remains a
  manual smoke checkpoint.
- The local post-build plist repair is not a source change and does not satisfy
  #1198's EAS development-build provenance. An EAS build must receive the same
  secure environment during prebuild so its native URL scheme is generated
  before signing.
- The existing production API does not yet represent this draft PR. The full
  #1199 matrix must still use the isolated branch-built API/engine and private
  gateway required by the issue.
- The production bundle identifier will require its own Google iOS client at
  the #1200 release gate.

## Failure triage

- The first aggregate PR gate failed two unrelated API tests. Triage found two
  orphaned `issue-1211` sandbox fixture processes and cleaned up only those
  exact detached fixtures.
- A first focused rerun was itself invalid because the restricted shell denied
  the tests' ephemeral localhost listeners (`listen EPERM`). Repeating the two
  exact tests with the PR gate's local-server permission passed 2/2.
- The complete PR gate then passed on rerun without a product change. No
  corrective issue was filed because the OAuth/mobile source did not cause the
  failure and the final repository gate was green.
