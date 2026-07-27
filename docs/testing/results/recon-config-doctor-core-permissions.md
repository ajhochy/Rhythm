# Recon — Config-doctor core permissions

Date: 2026-07-27
Sandbox: `/tmp/rhythm-dev-sandbox-smoke-writer`
Base URL: `http://127.0.0.1:4098`

This transcript records direct HTTP observations from the isolated backend. The
proposal row was seeded only in the sandbox SQLite copy because the application
does not expose a proposal-create route. The generated configuration and
proposal IDs were deleted from that copy after the observations.

## `POST /agent-configs`

- Status: `201`
- Rough duration: 53 ms
- Request `corePermissionsJson`: `{"bash":{"*":"ask","git push*":"ask"},"webfetch":"allow"}`
- Response body: an agent-config object with id
  `recon-core-permissions-1785174642727`; its `corePermissionsJson` was the
  supplied JSON string.

## `POST /agent-org-proposals/:id/approve`

- Status: `200`
- Rough duration: 6 ms
- Response body: the `refine-scope` proposal, with `status: "measuring"`, a
  `beforeSnapshotJson` containing the original core-permission JSON string,
  and the seeded `scopePatch` in `changeJson`.

## `GET /agent-configs/:id`

- Status: `200`
- Rough duration: 3 ms
- Response body: the same agent-config object. Its parsed
  `corePermissionsJson` was:

  ```json
  {
    "bash": { "*": "allow", "git push*": "ask" },
    "webfetch": "allow",
    "read": "allow",
    "glob": "allow"
  }
  ```

## Live endpoint availability

The following observations were made while the same foreground sandbox remained
attached:

| Path | Status | Rough duration | Body availability |
| --- | ---: | ---: | --- |
| `/health` | 200 | 23 ms | `{"status":"ok","service":"rhythm-api-server","commit":"dev"}` |
| `/opencode/health` | 200 | 3 ms | `{"status":"ready","message":"Opencode SDK ready","websearchConfigured":false}` |
| `/agents/capabilities` | 200 | 2729 ms | JSON capability map; `config-doctor`, `codex`, `gemini-cli`, `opencode`, and `claude-code` were `true`; it included `providerToAgentKind`. |
| `/opencode/auth/` | 200 | 21 ms | `{"providers":["openrouter","anthropic","openai","github-copilot","google"],"ready":true}` |
