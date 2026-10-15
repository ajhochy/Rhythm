---
tags: [decision, rhythm, dayflow]
---

# Dayflow first-party SQLite reader

## Context

The prior Dayflow composition required `RHYTHM_DAYFLOW_*` candidate variables
and constructed an intentionally inert CLI-wrapper source. That is not a
usable normal local setup, and running a third-party helper would add process,
telemetry, and sandbox concerns.

## Decision

Use the already-resolved `better-sqlite3` dependency to open only an explicitly
selected Dayflow journal in read-only mode with `query_only=ON`. Selection
validates the journal's canonical file identity and schema only. Dated reads
use the documented Dayflow v2.6.0 `timeline_cards` start-based 04:00 local
window query, parameter binding, a 1,000-row cap, field byte bounds, and the
existing normalizer/redaction/ledger/create-only pipeline. Never use SQLite
immutable mode so current WAL data remains visible.

The app stores its private config and ownership ledger in the normal app-data
directory beside the local database. It persists the selected journal path,
namespace, timezone, exclusions, and explicit enabled/automatic-import state,
but public DTOs expose only a bounded source label. Restart metadata/schema
revalidation does not inspect activity rows. Automatic import remains opt-in,
does not run immediately, and uses the manual import pipeline without any new
coordinator wakeup.

## Alternatives

- Continue the pinned helper/CLI runner: rejected because ordinary local setup
  would remain inert and would require executing an external helper.
- Use `immutable=1` for SQLite: rejected because it can miss an active WAL.
- Copy/import journal contents into Rhythm state: rejected because it expands
  private data retention and is unnecessary for a read-only adapter.

## Consequences

The v1 wire field remains named `bundlePath` for compatibility, but the UI
labels it as a local journal path and the gateway maps it only to SQLite
selection. A full real-journal smoke remains user-controlled and was not run.
