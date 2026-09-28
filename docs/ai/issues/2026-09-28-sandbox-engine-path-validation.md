# Follow-up: sandbox rejects the engine path it launches

Priority: P1 verification infrastructure. Scope: separate from consolidation review.

## Failure

`tools/dev/sandbox.sh up` builds the fork under
`apps/opencode_fork/packages/opencode/dist/opencode-darwin-arm64/bin/opencode`,
starts an engine successfully on `:4097`, then rejects that listener because the
SDK actually launches `apps/opencode_bin/opencode`.

## Repro command

Run `tools/dev/sandbox.sh up` with the four required sanitized fixture variables.
The API reaches ready state and `/opencode/health` reports `ready`, but
`record_engine_identity` exits with:

```text
sandbox: engine listener PID <pid> does not use this sandbox's built fork; refusing to record it
```

## Expected

The sandbox launches the freshly built `ENGINE_BIN`, records that exact listener,
and remains available on API `:4098` and engine `:4097`.

## Actual

Live process inspection during startup showed the `:4097` listener executable as:

```text
/Users/ajhochhalter/Documents/Rhythm/apps/opencode_bin/opencode
```

The API log simultaneously claimed the `RHYTHM_OPENCODE_BIN_DIR` override pointed
at the freshly built fork path. The sandbox then shut itself down safely; live
engine port `:4096` remained untouched.

## Root cause

The SDK's effective executable selection disagrees with the API's logged override
and the sandbox ownership validator. The sandbox therefore rejects its own
otherwise healthy startup.

## Likely files

- `apps/api_server/src/services/opencode_client_service.ts`
- `tools/dev/sandbox.sh`
- SDK `createOpencode` binary resolution

## Required fix and evaluation

Make executable selection unambiguous so the spawned process and
`record_engine_identity` agree on the freshly built fork. Add a regression that
places `apps/opencode_bin/opencode` in the repository while setting the sandbox
override, then proves the listener uses `ENGINE_BIN`. Re-run sandbox startup,
status, a live behavioral test, and teardown while confirming `:4096` is unchanged.
