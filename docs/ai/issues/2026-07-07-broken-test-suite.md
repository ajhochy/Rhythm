# Issue: API Server test suite is failing on main

- **Date**: 2026-07-07
- **Status**: Open
- **Priority**: High

## Failure

While running verification for the agent profile permission fix, the `api_server` test suite (`npm test`) failed with 22 failed tests. These failures are unrelated to the changes being verified and appear to be pre-existing issues on the `main` branch.

## Repro Command

```bash
cd apps/api_server
npm test
```

## Failures

There are two categories of failures:

1.  **Authentication Bypass**: Multiple tests that check for unauthenticated access (expecting a 401 status) are receiving 2xx statuses instead.
    - **Example**: `FAIL src/__tests__/agent_cookbook.test.ts > GET /agent-cookbook returns 401 when unauthenticated` (expected 401, received 200).
2.  **File System Errors**: Numerous tests related to the agent memory/vault feature are failing with `ENOENT: no such file or directory` errors.
    - **Example**: `FAIL src/__tests__/memory_injection_index.test.ts > AC3: a note edited directly on disk is reflected after re-index`

## Likely Cause

-   **Auth Failure**: The application's routers, such as `agentCookbookRoutes`, conditionally disable authentication based on the `env.agentLocal` flag. The test environment sets this flag to `true`, causing auth to be bypassed and the tests to fail.
-   **Memory Test Failure**: The `ENOENT` errors suggest a problem in the test setup or teardown logic for file-based tests. Temporary files or directories are likely not being created correctly or are being cleaned up prematurely.

## Required Fix

A full investigation of the test suite's environment configuration is needed.

1.  The `AGENT_LOCAL` flag's behavior needs to be addressed. Tests checking for auth enforcement should be able to run without auth being globally disabled. This might require providing a mechanism to toggle auth on a per-test basis.
2.  The file system logic in the memory-related tests needs to be debugged to resolve the `ENOENT` errors.

This is a significant issue blocking the verification of any backend changes and should be addressed with high priority.
