---
date: 2026-09-27
repo: rhythm
branch: codex/finish-1576-1582
pr: 1544
issues: [1576]
status: complete
tags: [retro, adherence]
smoke_result: blocked-http-400
verification_claimed: false
divergence: false
overall_score: partial
---

# Retrospective: #1576 provider probe contract

## Criterion comparison

| Criterion | Contract status | Observed status | Category |
|---|---|---|---|
| One authorized provider probe returns provenance evidence | Request shape was not locally executable/proven | The only live call returned HTTP 400, exhausting the allowance without provider evidence | C1 missing contract; P process |

## Adherence

- **Expected chain:** acceptance contract → prove the exact HTTP request contract locally without provider access → consume the single authorized live call → record evidence.
- **Observed chain:** acceptance contract → consume the live call → HTTP 400 → stop.
- **Skipped skills:** none established from the run record; the skipped control was the local request-contract preflight.

## Issues

- **P process — provider probe workflow:** the exact endpoint, payload, and response-handling contract was not proven locally before spending the one authorized live call. Detected from the completion log: the first recorded probe returned HTTP 400 and no retry was permitted.
- **C1 missing contract — probe preflight:** no executable provider-free check demonstrated that the request would be accepted by the local engine API before the live probe.

## Smallest durable correction

For any one-shot authorized provider probe, first replay the exact request against a provider-free local fixture or route-level contract check and require a non-400 accepted request shape. Only then consume the authorized live call. No skill or product edit is warranted from this single incident.
