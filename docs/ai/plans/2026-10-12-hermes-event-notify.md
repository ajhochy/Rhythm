# NOTIFY HERMES — bounded implementation and parent handoff

Approved workstream: owner `feat/hermes-event-notify-20261012`, base `4f915540`,
only `/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012`.
Explicit parent handoff satisfies workflow gate; no peers dispatched.

Approval controller/repository/routes, human signature/security consumer,
`apps/mcp_server/src/tools/agentApprovals.ts` and MCP `index.ts` are reserved and
untouched. Notifications neither create, decide nor consume approvals. No commits,
pushes, SSH, Pi deployment, service/container/live restart or network config changes.

Candidate slice: existing engine event hub → isolated durable SQLite journal →
authenticated replay/SSE + honest consumer ACK → outbound Python subscriber →
versioned local adapter receipt contract. The actual Hermes adapter remains a
bounded runtime blocker, not a fictitious successful delivery.

See [trust contract](../contracts/hermes-event-notify-v1.md) and
[run/evidence](../runs/2026-10-12-hermes-event-notify.md).

Parent-only remaining integration after approval owner finishes:

1. Review the four-line `app.ts` import/mount hunk; no overlapping migrations were edited.
2. Bind origin in the actual authenticated dispatch transaction/client before execution.
3. Publish canonical card IDs from approval owner's committed notification hook, not
   by accessing its repositories or inventing an approval lifecycle here.
4. Prove existing private relay routing/auth streaming compatibility; do not alter
   network/listeners without renewed authorization. Current direct sandbox SSE proof
   is **not** a private relay qualification.
5. Supply an owner-registry/atomic-receipt Hermes session adapter on the Pi through
   a separately authorized change. Source evidence points to the TUI notification
   poller but it is an internal global queue, not an external durable ingestion API.
6. Run actual original-session busy/reconnect/restart and browser-closed tests against
   a supported disposable runtime; separately report ingestion/wakeup/visibility.
7. Review source-gap recovery, disk retention, SQLite mount schema vs managed migration
   placement, and long-lived auth revocation before deployment. This candidate is not
   production-ready or full acceptance complete.

Independent verification: parent/verifier runs the fixed acceptance scripts against
a fresh isolated sandbox and adapter fixture without editing their assertions. The
implementation owner is not the independent verifier. No unchanged approval needs
to be re-requested; missing runtime capabilities are technical gates, not new scope.
