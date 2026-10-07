---
date: 2026-10-06
repo: Rhythm
branch: integration/2026-10-06-resume
tags: [run, Rhythm, routing]
---

# Routing classifier comparison: Kev-4B vs Qwen3-4B-Instruct-2507 (2026-10-06)

Instrument: apps/api_server/scripts/router_calibrate.mjs (commit 91444863; test suite 8/8 pass), 50 labelled prompts (20 core + 30 extras), loopback only, one server at a time. Raw JSON/logs: kev-pass{1,2,3}.json/.log, qwen3-4b-pass{1,2,3}.json/.log, kev-cold.json, analyze.mjs (the numbers below come from it).
Passes 1-3 of each candidate were bit-identical in picks and confidences (deterministic); latency varied by a few ms.

## Kev-4B (System One, typed choice head)
| Item | Result |
|---|---|
| Identity | jaredpalmer/kev-4b snapshot 139fdd94f1b6a6ad80cc15e08fcb99cac885a101 (LoRA r16 + pointer head, trained from init 957b91e7...); base Qwen/Qwen3.5-4B-Base rev 1001bb4d826a52d1f399e183466143f4da7b741b (per provenance.json); served model field `kev-latest` (alias `jev-latest`), backend mlx, device mps, bfloat16, served temperature 2.406 |
| Availability | Started OK; /v1/models answered in ~41 s from process launch (includes uv startup). |
| Accuracy | 20-core 17/20 (85%); 50-set 40/50 (80%). Per tier: cheap 17/17, standard 10/17, frontier 13/16. Over-routed 1, under-routed 9 (mostly standard picked as cheap). |
| Latency | Cold first call (separate, immediately after server ready) 579 ms. Warm (3 passes, 50 calls each): p50 416-429, p95 710-732, max 817-837 ms. Over 1000 ms: 0. First recorded call in each pass 305-342 ms. |
| Fallback | Timeouts 0; malformed/failed rows 0; low-confidence (<0.55) 13/50 -> standard; accuracy after fallback 44/50 (88%). |
| Confidence | Coverage >=0.55: 37/50 (74%). Accuracy >=0.55: 35/37 (95%); <0.55: 5/13 (38%). Miss confidence range 0.39-0.63. Reliability (bin: correct/n): 0.3: 1/4, 0.4: 3/7, 0.5: 10/12, 0.6: 7/8, 0.7: 12/12, 0.8: 6/6, 0.9: 1/1. |

## Qwen3-4B-Instruct-2507 Q4_K_M (letter A/B/C logprobs)
| Item | Result |
|---|---|
| Identity | unsloth/Qwen3-4B-Instruct-2507-GGUF snapshot a06e946bb6b655725eafa393f4a9745d460374c9, Q4_K_M; llama-server 0.5.0 (build 11146, commit 7fe450e19), AppleClang, Darwin arm64; `-c 4096`, Apple GPU/Metal by default (I did not verify the offload line in the log) |
| Availability | Started OK; /health ok within ~7 s. |
| Accuracy | 20-core 13/20 (65%); 50-set 30/50 (60%). Per tier: cheap 17/17, standard 12/17, frontier 1/16. Over-routed 0, under-routed 20 (almost all frontier prompts sent to cheap/standard). |
| Latency | Cold first call NOT separately measured (the script's reachability probe absorbs it; model was already loaded at server start). First recorded call per pass 30-46 ms. Warm p50 131-132, p95 156-158, max 265-293 ms. Over 1000 ms: 0. |
| Fallback | Timeouts 0; failed rows 0; low-confidence (<0.55) 0/50 (one row at 0.5-0.6 bin counted >=0.55), so fallback changes nothing: 30/50 (60%) after fallback. |
| Confidence | Coverage >=0.55: 50/50 (100%). Accuracy >=0.55: 30/50 (60%); <0.55: n/a. Miss confidence range 0.75-1.00 (confidently wrong). Reliability: 0.5: 1/1, 0.7: 1/2, 0.8: 3/3, 0.9: 25/44. |

## Reading
On this set Kev is clearly more accurate (80% vs 60%) and much better at frontier recall (13/16 vs 1/16). Its confidence is informative (95% accurate when acting, 38% below threshold, and the 0.55 fallback lifts it to 88%). Qwen3-4B's confidence carries no signal here: it is 0.9+ on most rows including the 20 wrong ones, so the 0.55 gate never fires and frontier work would be silently under-routed. Qwen3-4B is about 3x faster (p50 ~130 ms vs ~420 ms); both are inside the 1000 ms budget with no timeouts. The gap (20 pp on n=50) exceeds the stated +/-11 pp, so Kev being ahead on accuracy and calibration on this set is supported, but see caveats before treating it as a qualification.

Not done: the optional in-app check (router_systemone_live.test.ts) did not run. I invoked it with `timeout`, which does not exist on this macOS shell, so vitest never started; I then stopped Kev and did not restart it.

## Caveats (mandatory)
- The 50 prompts are synthetic and are the same set Kev's prior "80%" claim came from (not held-out); the 80% here reproduces that figure, which is not independent confirmation.
- n=50 gives roughly +/-11 pp.
- The methods use different protocols (letter logprobs vs typed choice head), so confidences are not directly comparable.
- This is a comparison, not an On-qualification.
- Router remained Shadow; decision-router.json was never touched (mtime 1791171397 before and after).
- $0 spent; no accounts, keys, downloads, or settings changes; Gemini not probed.
- No historical Qwen3.5 routing results exist (only Qwen3-4B-Instruct-2507 was ever wired).
- No winner is declared for On-qualification. Kev is ahead on this set, but neither candidate is qualified: the set is not held-out and Kev still under-routes 9/50 (standard sent as cheap) before fallback.

## Cleanup
Both servers stopped; `lsof -nP -iTCP:8009 -iTCP:8013 -sTCP:LISTEN` empty. Free memory stayed >= 47% (memory_pressure), never near the 4 GB floor. The live Rhythm ports (4001/4002/4096) were not touched.
