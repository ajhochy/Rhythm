---
date: 2026-09-29
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Kev (System One) for model routing

## Context

Model routing classified a session's first prompt into `cheap` / `standard` / `frontier` by reranking it
against three tier descriptions (`classify()`), or, on the `jev` backend, by one yes/no question per tier.
Calibration showed both are unreliable: the reranker matches topic, not difficulty.

Kev-4B (open source, Jev-compatible `POST /v1/systemone`) asked ONE typed `choice` question with the three
tiers as options scored 80% on 50 labelled prompts (cheap 17/17, standard 10/17, frontier 13/16). Its
probabilities are well calibrated: every miss had top probability 0.38–0.63; confidence ≥ 0.55 is 95%
accurate on 74% of prompts; ~345 ms average. Falling back to `standard` below 0.55 gives ~88% with no
over-routing.

## Decision

- New backend `systemone` (`{baseUrl, model, apiKey}`; default `http://127.0.0.1:8009`, `kev-latest`,
  timeout 1000 ms). Hosted Jev is the same backend at `https://api.typesafe.ai` / `jev-latest`.
- Model routing on `systemone` asks one `choice` question (`SystemOneClient`); confidence = top probability.
- New `routing.lowConfidenceTier` (`keep` | `standard`, null = backend default): `standard` for systemone,
  `keep` for every other backend. New `routing.minConfidence` setting (default 0.55, env still wins).
- Tool and memory ranking stay on the local reranker settings under `systemone`; memory text is never
  sent to the System One backend.
- URL rule: loopback `http` needs no consent; anything else needs `https` + `remoteDataConsent`.

## Alternatives

- Keep tuning tier descriptions for the reranker: topic-matching is structural, not a wording problem.
- Example-prompt reranking / a small instruct LLM classifier (methods B/C in `router_calibrate.mjs`):
  measured, less accurate or less calibrated than Kev.
- Replace the `jev` backend in place: kept it working instead; `systemone` subsumes hosted Jev.

## Consequences

- Needs a separate Kev process (`uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b --port 8009`).
- With the backend not `systemone`, routing behaviour is unchanged (low-confidence policy defaults to `keep`,
  min confidence still 0.55).
- Recommended rollout: `first_prompt` scope, Shadow for a week, then On.
