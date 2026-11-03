# Deliverables completion acceptance contract

The human request has no GitHub issue number. The schema adaptation is explicit:
`issue` is the request-task string `deliverables-completion`, and stable IDs are
`issue-deliverables-completion-cN`. No GitHub number was invented. Other fields
follow `/Users/ajhochhalter/Documents/agent-stack/docs/contract-schema.md`.

The dependency-free TypeScript tests use Node 22's built-in test runner; no npm
installation or product import is required. They live outside the Vitest default
discovery and skip unless `RHYTHM_LIVE_E2E=1` is set.

## Initial RED

From the isolated checkout:

```sh
RHYTHM_LIVE_E2E=1 RHYTHM_QUALIFICATION_BASE_URL=http://127.0.0.1:4001 node --experimental-strip-types --test tests/contract/request-deliverables-completion.spec.ts
```

Before implementation, this command exited 1 with an ordinary assertion failure:
`GET /qualification-fixtures/capability returned 404`, expected 200. The first
test ran in 21.7 ms. There was no missing-module/import/runtime error, mutation,
model call, API/engine launch, or user-data edit. Fixture mutations were not run.

## Fixture interface and trust boundary

`GET /qualification-fixtures/capability` returns `{available, sourceRevision,
runtime:{apiPid,enginePid,enginePort,bootId},fixtureModes,
protectedEvaluator:{qualified,...}}`. Supported modes are `dayflow`,
`router-exhaustion`, `router-corrupt`, and `coordinator-delivery`.

All creation/mutation requires an explicit private app-startup fixture manifest
and test-owned token/owner, rather than ordinary human approval authority. To run
mutation checks, additionally set `RHYTHM_QUALIFICATION_MUTATIONS=1`,
`RHYTHM_QUALIFICATION_FIXTURE_ROOT` under `/private/tmp`,
`RHYTHM_QUALIFICATION_OWNER_ID`, and `RHYTHM_QUALIFICATION_TOKEN`. The token must
not be printed or retained in evidence.

`POST /qualification-fixtures` accepts `{mode,fixtureRoot,ownerId,requestId}` and
returns 201 `{id,bindings,...}`. These supplied values must match startup
authority; the request cannot grant ownership, approval, verdicts, counters,
canonical routing provenance, or source consent. Fixtures must be isolated from
all existing user stores/sessions. Foreign owner creation returns 403;
unauthenticated mutation returns 401 or 403.

`POST /qualification-fixtures/:id/cases/:caseName` returns `{caseName,bindings,
checks:[{id,pass,observed}],dispatch:{sdkBefore,sdkAfter,providerBefore,
providerAfter},limits}`. Bindings include fixture/session/SDK identity, exact
source revision, API/engine PIDs, engine port and boot ID. Supplying an incorrect
`expectedBootId` must return 409 before case execution. Expected case names and
concrete observation assertions are frozen in the executable tests.

Receipts alone are not independent proof. The root verifier must inspect the
actual guarded production Dayflow/routing dependencies, SDK state and provider
dispatch instrumentation, independently observe zero deltas, bind each receipt
to the running candidate, and challenge foreign/revoked/stale authority. A case
implementation that sets counters or desired verdicts without driving the real
production path is invalid even if these tests are green. Neither candidate
signatures nor worker-edited test/hash observations can replace a protected,
independently qualified artifact evaluator.

The coordinator-delivery case must reuse a genuinely completed, independently
verified coding receipt and drive completed-before-delivery hold/release plus
duplicate events through production delivery. Its count fields must derive from
actual worker/result/wake records. Synthetic `workerCount:1` output cannot prove
a Coordinator -> manager -> sole coding-worker workflow. Genuine original-chat
human approval, real worker/artifact verification, native readable result,
cancellation/revocation, installed package and restart remain explicit manual
gates. Manual criteria must be reported pending until their evidence exists.

Free public coding, S3 schedule resume-existing, real-provider quality and
private/cross-user Memory quality remain unsupported/unproven. Instruction
compliance does not establish engine-wide watchdog or filesystem writer
guarantees.
