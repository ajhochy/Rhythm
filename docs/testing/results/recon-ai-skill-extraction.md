# Private skill extraction: observed packaged transcript

On 2026-10-21, a single exclusive native Recon ran against the locally signed `825c53bc9f1b4d3081de8a6a5a5c38de129a93d9` bundle and a fresh disposable `.invalid` actor. The private report recorded 1 expected, 0 unexpected, 0 skipped, 0 flaky; run and whole-loan scrub both exited 0, with source hashes unchanged. The sanitized observation is in `/private/tmp/rhythm-skill-extract-recon-20261021/output-0T2ZJA/observation.json`. This is Recon evidence, not a passing checked test.

| Observed path | Result |
| --- | --- |
| Normal UI named chat, fixed OpenAI GPT-6 Luna, two nonce-owned literal echo turns | Two visible answers, two persisted SDK inputs, two completed Luna outputs, zero tool parts |
| Background queue | Exactly one `[skill-extract] queued for <owned local chat ID>` marker |
| New system session | Exactly one `skill-extract` row in `self_improvement`, `is_system=1`; its SDK input included both owned source prompts |
| Background assistant | One completed OpenAI GPT-6 Luna assistant, zero tool parts |
| Third UI turn | Visible/persisted Luna answer; queue marker and system-row counts stayed at one |
| Cleanup | Exact system and chat deletes returned 204; synthetic profile and model visibility restored; no cleanup errors |

The row has no durable source-session foreign key. Attribution uses the fresh initially empty fixture, exact queue marker, one new system row, and the two nonce prompts in that system session's SDK input. This does not establish all trigger timings, restarts, retries, or provider choices outside this fixed-Luna actor. No raw prompt, provider credential, or runtime log is included here.
