# Synthetic session auto-naming: observed private behavior

An independent Recon ran against the exact locally signed `b7d5db0af960196a3ca3ed0291877f7e7d2e0771` app, a fresh disposable signed-in actor and a bounded model loan. It passed **1/1** (6.7-second case, 42.3 seconds total, CLI exit 0). The raw owner-only observation is `/private/tmp/rhythm-session-autoname-recon-20261020/output-j1yAGu/observation.json`; the whole loan was scrubbed with unchanged source hashes. This summary omits credentials, actor identifiers, private paths and raw messages.

- A normal authenticated session create with an empty name returned one owned SDK session and an initially empty name. The synthetic coding profile was revision-patched to fixed OpenAI GPT-6 Luna with all effective tools denied; normal model-visibility API and the real engine projection agreed before the turn.
- The signed-in UI sent one nonce-marked arithmetic prompt. The real engine completed one parent-linked OpenAI GPT-6 Luna assistant answer, `42`, with zero tool parts. The local input/output rows matched the exact SDK user/assistant message IDs.
- The engine generated `17 + 25 calculation`. The normal API detail, SQLite row, history list and rendered session rail adopted that exact generated name. After a normal renderer reload, the same name remained in the detail, list, row and rail, and the answer remained visible.
- The exact owner/cwd/profile/SDK identity was checked before the owned session's normal hard delete. The engine session and local row were absent afterward; cleanup errors were empty. No title was supplied by the test and no synthetic title event or provider response was injected.

The checked-in packaged case transcribes the observed equality and persistence contract without requiring this particular generated phrase. It is **not yet independently Confirmed** on a fresh loan. The hidden title agent's separately served model was not observed, and mobile/hosted naming remains outside this result.
