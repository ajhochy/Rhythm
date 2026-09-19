---
tags: [decision, rhythm]
---

# Ship the Hermes sidecar before any bundled payload

## Context

The Phase 0 payload spike could not produce a clean lock-qualified Python 3.12 Hermes build. A relocated Python 3.11 diagnostic ran the two CLI probes and all 71 Mach-O files accepted ad-hoc signing, but it occupied 404.5 MiB, contained 138 installed distributions, differed from the lock, retained build-origin metadata, and was not tested as a real offline server or distribution-signed app.

The spike therefore recorded NO-GO for Phase 2. Its evidence is useful for a later packaging attempt but is not a release artifact.

## Decision

Ship only the supervised installed-Hermes sidecar in this campaign. Electron discovers Hermes through the login shell, starts `hermes dashboard --port 9121 --host 127.0.0.1 --no-open`, mints the dashboard token in the main process, polls `/api/health`, and stops only its owned child. Missing Hermes uses an explicit native consent flow; occupied ports and failed starts remain visible failures rather than attaching to or killing another process.

Do not add a Python/Hermes payload to `Rhythm.app`. Resume Phase 2 only after a clean locked build passes manifest, complete inventory, offline real-server startup, license, nested signing, hardened-runtime, notarization, and clean-installed-app gates.

## Alternatives

- Bundle the relocated diagnostic: rejected because it is not lock-qualified, is oversized by optional packages, and lacks offline server and distribution-signing evidence.
- Treat successful ad-hoc signing as release qualification: rejected because it does not prove Developer ID signing, hardened runtime, library validation, Gatekeeper, or notarization.
- Roam to a free port or adopt an existing listener: rejected because fixed ownership and honest port-in-use failure are safer and diagnosable.
- Block the entire Hermes tab until bundling succeeds: rejected because the installed sidecar is independently deliverable and preserves the same isolation boundary.

## Consequences

The Electron integration depends on an installed Hermes runtime and has an honest absent/install path. `RHYTHM_HERMES_ENABLED=0` disables launch and UI without changing the default engine. The signed app remains smaller and avoids shipping unqualified native code.

Bundled offline use, Developer ID/notarization, payload provenance, and clean-machine startup remain open work. The Phase 0 NO-GO must be superseded by new evidence before packaging code is added.
