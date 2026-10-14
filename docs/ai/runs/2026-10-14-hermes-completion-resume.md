---
date: 2026-10-14
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: 1616
issues: [NOTIFY-HERMES]
status: pending_ci_and_operator_ssh_check
tags: [run, rhythm]
---

# Completion resume and permission authorization

## Files

- Preserve the receiver, native patch, exact manifest, subscriber adapter, installer,
  tests and accumulated run receipts in the retained notification worktree.
- Commit owned implementation/receipts, not the copied third-party source tree or
  raw temporary diagnostics. The hash manifest and guarded capture procedure retain
  fixture provenance; the local source snapshot remains intact and ignored.

## Checks

- Independent gate `4f0b4373-a18e-426e-8790-9d762774df33`: real sandbox Rhythm SSE to
  subscriber to actual copied WebUI to unobscured Chromium receipt to actual Rhythm
  ACK passed; one provider call, wrong-run ACK404, consumer reopen/retry, tombstone2,
  database state visible and foreign workflows unchanged. Native30 and migration11
  passed. Test provider is upstream fixture setup only, not production code.
- Independent final identity gate `baa5df2a-2df0-4cec-bc9d-217631def247`: host38,
  independent13 scenarios and8 invalid-input denials passed; all seven native outputs
  and107 original source pins verified. Static identity updates preserve product
  hashes and prior native/ACK evidence. Actual host installation is NOTRUN.
- Current pushed head `ee914fce` server CI failed in run38472690195/job115555535546.
  Read-only failure triage dispatched; no failure waived and no cause inferred merely
  from engine connection warnings. New implementation head requires new CI.
- Strict SSH hostname probe now pauses for an existing Tailscale SSH operator check.
  No host-key policy was bypassed. Permission attempt timed out before recording a
  source-mode receipt; no permission update was reached or claimed. Retest after
  operator check, record all original modes/uid/gid/inodes and exact rollback
  commands before applying the approved eight nonrecursive changes, then verify.

## Notes

- AJ separately approved only these source permissions: four exact directories
  (`stacks`, `hermes-webui`, `api`, `static`)775 to755; four exact files (`server.py`,
  `api/routes.py`, `api/models.py`, `static/ui.js`)664 to644. No recursive operation,
  ownership change or broader permission change authorized.
- Prior exact authorization: install the tested WebUI change with one planned
  restart, retain current image/configuration for rollback, and restart from an
  independent host-side job. It remains conditional on separate-copy tests and all
  current installation gates. Latest permission approval creates no new restart
  or deployment grant. No live restart has occurred; rollback needing another
  restart requires separate approval.
- Native browser/session/ACK proof is copied-server plus real sandbox API evidence,
  not deployed Pi/private-relay or AJ-live-conversation smoke. Current chats,
  production providers, databases and approval cards remain untouched.
