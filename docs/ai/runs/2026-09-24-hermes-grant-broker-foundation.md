---
date: 2026-09-24
repo: rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: [1569]
status: partial
tags: [run, rhythm]
---

# Hermes grant broker foundation

## Files

Adds the main-only credential grant broker, sender/confirmation adapter seam, and portable tests. The store contains consent references, never provider values or fingerprints. The callback resolves approved static API keys for an exact server, Rhythm user, default profile, canonical Hermes home, source and authentication generation. Memory-search remains disabled. Existing Hermes-owned credentials take precedence.

## Checks

Source base `b4b24d56` plus this broker slice:

- Initial contract RED before product module, existing S1 reader checks remained green.
- Parent review reproduced two failures: revoking one of multiple grants still reported applied; changing the mutation during confirmation could grant an unconfirmed provider. Both regression tests now pass. Short/stalled file writes are tested and do not promote malformed grant data.
- Parent independent `node --test apps/electron/test/hermes-accounts.test.mjs apps/electron/test/hermes-credential-broker.test.mjs`: 27/27, exit 0.
- Integrated `npm test` in `apps/electron`: 232/232, exit 0.
- Integrated `npm run typecheck`: exit 0. Candidate syntax and whitespace checks pass.
- GitNexus impact for new broker/store symbols is UNKNOWN because the new module is absent from the stale index. No application caller exists yet; tests cover the exported broker and adapter seams.

External evidence: `/Users/ajhochhalter/Documents/rhythm-orchestration-evidence/2026-09-24-repair4/s2-*`. Generated shell screenshot retained externally and restored in git.

## Notes

No real credential store was read or changed. Main/preload IPC, fresh sender and document identity checks around the real native dialog, Accounts UI, actual owned spawn success callbacks, identity disposal and installed-runtime qualification remain required. Passing adapter tests do not prove those connections exist. Status distinguishes configured consent from a successful owned spawn and pending restart; it does not claim to erase a credential already copied into a process. Filesystem prechecks do not provide an OS-level openat transaction against hostile same-user path replacement.

All 28 canonical #1569 criterion IDs/texts are preserved; only S2 test metadata is added. No new closing keyword or overall feature-completion claim.
