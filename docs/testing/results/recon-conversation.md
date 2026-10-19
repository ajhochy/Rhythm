# P0 recon: conversation

Date: 2026-10-19. Test source base: `894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`.
Locally built target: `/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app` **0.18.83**. Engine health reports
`0.0.0-rhythm-894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`. This bundle was built locally from the mega source head; the API build-identity JSON and engine version both match it. Ports were free before launch.
The existing `packaged-app.ts` fixture launched the app and quit it; no live
API process was started by hand. No messages to real people were sent. Model prompts recorded below used the explicit opt-in and nonce-owned sessions.

## Observations before codification

Existing session transcript and composer render. `GET :4096/global/health` → 200 with `{healthy:true,version,pid,bootId}`. The read-only recon made no model call; the user subsequently explicitly authorized `RHYTHM_FEATURE_MODEL=1` for the P0 confirmation run. Real streaming, cancellation, duplicate-free order and cross-session isolation remain UNVERIFIED.

Probe command (temporary recon spec, removed after codification):
`cd apps/web && RHYTHM_PACKAGED_APP=/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app ./node_modules/.bin/playwright test -c tests/packaged/recon-playwright.config.ts`
Captured local output: `/private/tmp/rhythm-feature-recon-mega.log` (sanitized shape/count summaries; not committed).
Read-only probe: 1 test finished in 42.7s, no renderer errors. This only means
the probe completed; feature assertions had not yet been authored.

## Fresh mega-head model recon

A nonce-owned named session on a temporary directory was created through Advanced session. The UI composer sent a no-tool arithmetic prompt (37 + 54). After 15 seconds, local session detail was `idle`, provider `openai`, model `gpt-6.1-sol`. The API had exactly one input and one output (`91`). Engine `/session/<owned-sdk>/message?directory=<owned-temp>&limit=50` returned 200; the assistant text part was `91`, finish `stop`, and step-finish served-model stamp `gpt-6.1-sol`. The UI transcript displayed the same prompt followed by `91`, not an optimistic-only message. Probe completed in 50.7s including launch/quit. Cleanup hard-deleted the owned local/SDK session. Private raw probe output is local-only at `/private/tmp/rhythm-feature-model-recon.log`; system prompts, memory, identities and credentials are not copied here.

The earlier combined run was interrupted by the operator agent during a reply wait (not a proved product failure). It remains interrupted evidence; the original assertion is being confirmed separately, unchanged.

## Confirmation observations

The arithmetic main path reaches a real provider and returns `91`. UI, durable engine text and canonical API messages contain one matching owned prompt and the answer; reload preserves order without an optimistic duplicate. Engine assistant metadata includes providerID/modelID. A rendered streamed token can precede durable part/readback updates; those checks poll their actual outcomes for up to 30 seconds.

Two owned sessions produced independent `303` and `42` answers and retained their own prompts through switching/reload; engine transcripts contained no cross-session prompt. The blank/draft case observes the actual `Start this conversation` empty state, not a nonexistent transcript element.

The extended cancellation probe observed UI `1, 2, 3` while the SDK status was still busy, then UI Cancel sent POST `/agent-sessions/<owned-id>/cancel` → 204, engine status returned to idle, and Send returned. The canonical engine retained exactly one prompt. These behavioral assertions can succeed while the case remains red on the unrelated invalid branch-request ERROR; no such errors are suppressed. Reconnect/event loss and older-page boundaries remain an explicit failing gap.
