# Issue #1174 red baseline

Date: 2026-07-25

Command:

```bash
cd apps/mobile
node --test tests/issue-1174-opencode-parity-contract.test.mjs
```

Observed result: **exit 1; 0 passed, 3 failed**.

- `issue-1174-c1` failed because all 133 shipping contract operations still
  lack the reviewed `classification` and `reason` fields.
- `issue-1174-c2` failed because the checked-in shipping contract records
  OpenAPI SHA-256
  `fd0aae2af9c69775409c399056cffeb39fd1f248f56abff7dae391895ca1add8`,
  while the bundled 1.14.49 OpenAPI currently hashes to
  `4d4e279ce858a0bdb33399b004ef1268e415b7fcbe5029eee93bee94e5759636`.
- `issue-1174-c3` failed because the generic gateway currently allows six
  operations classified as safer-alternate-only:
  `config.providers`, `mcp.auth.authenticate`, `permission.respond`,
  `session.get`, `session.message`, and `session.prompt`.

This is the intended pre-implementation failure state. The classification
inventory itself covers 133 unique bundled operations with no missing or extra
operation IDs: 75 `surfaced`, 10 `internal`, 7 `alternate`, and 41
`intentionally-omitted`.
