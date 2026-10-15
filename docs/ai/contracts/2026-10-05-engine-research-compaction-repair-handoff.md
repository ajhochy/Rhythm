# Engine research compaction repair handoff

This is a source-only, isolated-fork repair. It is not live-engine or package acceptance.

The pinned SessionPrompt loop now carries only exact internally-created compaction controls and synthetic continuation/replay user messages across its own user-boundary filter. An ordinary user queued after the pinned request remains excluded. Completion checks use the active internal user parent, retaining the normal terminal/parent invariant for both a summary control and a continuation. A same-assistant overflow request is detected before a second automatic compaction marker can be appended.

`SessionCompaction.create` now returns its durable user marker. `process` returns its continuation status plus the exact synthetic follow-up ID, if one was written. The manual HTTP compaction caller remains compatible because it ignores the newly returned message value.

Changed paths:

- `apps/opencode_fork/packages/opencode/src/session/prompt.ts`
- `apps/opencode_fork/packages/opencode/src/session/compaction.ts`
- `apps/opencode_fork/packages/opencode/test/session/prompt.test.ts`
- `apps/opencode_fork/packages/opencode/test/session/compaction.test.ts`

The accompanying delta patch and freeze record exact source hashes. Protected session message/processor/overflow and HTTP compaction-handler bytes were not edited. The repair does not recover or mutate the historical 12,000-marker persisted session; runtime recovery remains a separate, evidence-backed decision.

## Typecheck correction

The final four-path packet also corrects three source/test typing defects found by Root's bounded package typecheck. The compaction result retains an underlying processor `stop` (including a blocked result without `assistantMessage.error`) rather than converting it to `continue`; its status is explicitly the declared union. The focused fixture now compares sync event type rather than incompatible generic definition identities and emits the supported `text-delta` shape. A new process-level regression confirms the no-error `stop` contract. The required serialized focused prompt/compaction/cancellation checks and `bun run typecheck` pass.

Remaining gate: Root must apply/review these exact bytes and qualify them with the CPU investigator after load clearance. No claim is made about a running engine, package, or normal app behavior from the focused tests.
