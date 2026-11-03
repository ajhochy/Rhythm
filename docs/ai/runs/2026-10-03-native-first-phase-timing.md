---
date: 2026-10-03
repo: Rhythm
branch: codex/native-first-terra-local-20261003
pr: null
issues: []
status: unverified
tags: [run, rhythm]
---

# Native-first semantic retrieval phase timing

## Files

- `apps/api_server/src/services/memory_retrieval.ts` — starts the native search before synchronous FTS probing; keeps one deadline and adds internal body-free phase timing to the existing semantic log line.
- `apps/api_server/src/__tests__/memory_retrieval_semantic.test.ts` — covers initiation ordering, fallback/injectability protection, and fake-fetch unavailable versus timeout results.
- `apps/api_server/src/__tests__/issue_1573_semantic_degradation.test.ts` — covers body-free diagnostics plus unavailable, HTTP-timeout, and downstream-deadline phase distinction.

## Checks

- RED before implementation:

  ```sh
  cd apps/api_server && env -i HOME=/private/tmp/rhythm-native-first-test-home TMPDIR=/private/tmp/rhythm-native-first-test-tmp PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /bin/zsh -f -c 'npx vitest run src/__tests__/memory_retrieval_semantic.test.ts src/__tests__/issue_1573_semantic_degradation.test.ts'
  ```

  Result: 46 passed, 5 failed. The new native-before-FTS and phase-metadata assertions were red. Three existing degradation expectations also failed because their mocked native candidates have no selected canonical file in the isolated vault and therefore fail closed as `unmapped`.

- Focused new regressions:

  ```sh
  cd apps/api_server && env -i HOME=/private/tmp/rhythm-native-first-test-home TMPDIR=/private/tmp/rhythm-native-first-test-tmp PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /bin/zsh -f -c "npx vitest run src/__tests__/memory_retrieval_semantic.test.ts src/__tests__/issue_1573_semantic_degradation.test.ts -t 'distinguishes an unavailable|initiates native search|retains the FTS fallback|records bounded body-free|logs a distinct body-free|records downstream deadline'"
  ```

  Result: 7 passed, 47 skipped, 0 failed.

- Relevant non-server synthetic suites:

  ```sh
  cd apps/api_server && env -i HOME=/private/tmp/rhythm-native-first-test-home TMPDIR=/private/tmp/rhythm-native-first-test-tmp PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /bin/zsh -f -c 'npx vitest run src/__tests__/memory_retrieval_semantic.test.ts src/__tests__/memory_retrieval_default_mode_smoke.test.ts src/__tests__/memory_retrieval_ranking_smoke.test.ts src/__tests__/memory_semantic_latency_smoke.test.ts src/__tests__/memory_provenance.test.ts src/services/memory_retrieval_rerank.test.ts src/__tests__/managed_workstream_evidence_capture.test.ts'
  ```

  Result: 7 files, 105 passed, 0 failed. These files were inspected for listening-server calls before execution.

- API static check:

  ```sh
  cd apps/api_server && env -i HOME=/private/tmp/rhythm-native-first-test-home TMPDIR=/private/tmp/rhythm-native-first-test-tmp PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /bin/zsh -f -c 'node_modules/.bin/tsc --noEmit --incremental false'
  ```

  Result: exit 0.

- Existing degradation-file check:

  ```sh
  cd apps/api_server && env -i HOME=/private/tmp/rhythm-native-first-test-home TMPDIR=/private/tmp/rhythm-native-first-test-tmp PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /bin/zsh -f -c 'npx vitest run src/__tests__/issue_1573_semantic_degradation.test.ts'
  ```

  Result: 10 passed, 3 failed. The unchanged failures expect `no_confidence`, `lexical_gate`, or `used` from synthetic native candidates that lack a selected canonical file; current canonical selected-file validation returns `unmapped`. This task did not weaken validation or repair those unrelated fixtures.

- Hygiene:

  ```sh
  git diff --check
  ```

  Result: exit 0.

## Notes

- Native initiation is now before the synchronous SQLite FTS probe fan-out, while both lanes use the existing shared semantic deadline. The default budget remains 500 ms.
- The existing log prefix remains `semantic status=<status> hits=<count>`. Optional suffix fields are closed phase values and capped finite `pre_search_ms`, `elapsed_ms`, and `remaining_ms`; no retrieval content or identifiers are logged.
- GitNexus is not indexed for this descendant. The registered parent Rhythm index reported `collectNativeMemoryReferences` and the test helper absent (UNKNOWN); `settleBeforeDeadline` was LOW risk (2 direct, 8 total, no affected process). Local source inspection covered all local callers.
- NOT RUN by explicit constraint: full API suite, server/listening tests, sandbox, engine/model inference, live API/native endpoint checks, and application launch. No claim is made that ordering caused the observed scheduled timeout; live qualification remains required.
