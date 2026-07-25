---
name: social-video-pipeline
description: Turn a supplied script into a local, zero-key OpenMontage documentary-montage draft using Piper narration and review-selected public-source footage. Human approval is required for both script and assets; posting is never automatic.
---

# Social Video Pipeline

Input: a **script** — the text/copy/voiceover lines for one social video, given directly in the request.

This profile uses only the local `openmontage` MCP. The default workflow is a zero-key, local review draft:

- Narration is generated locally with the installed Piper voice model.
- Candidate footage comes only from the wrapper's fixed no-key public-source adapters and is stored with source/provenance details.
- FFmpeg creates the local vertical montage with burned sentence captions after selection approval.
- Music is optional and can come only from the fixed local library with declared license/source metadata; it is never downloaded or chosen automatically.
- No paid provider, publishing, sharing, export, deletion, or arbitrary shell command is available.

## Steps

1. **Preflight.** Call `openmontage_capabilities` once. Confirm `piper_narration_ready` is true and explain whether caption burn-in is available. If Piper or FFmpeg is unavailable, stop and explain the blocker; do not substitute a cloud provider.
2. **Create the script review.** Call `openmontage_create_script_review` with the supplied title, script, and fitting style. Present the script/timing summary and say it is awaiting approval. Do not acquire assets or render yet.
3. **Script approval gate.** Wait for the requester to explicitly approve the script. On `fix: <feedback>`, create a new script review with the feedback incorporated and return to step 2. On `abandon`, stop. Nothing is published, deleted, or downloaded.
4. **Prepare zero-key candidates.** After explicit script approval, propose at most three concrete footage-search phrases, then call `openmontage_prepare_zero_key_assets` with `script_approved: true` and `clips_per_query: 1`. Present the Piper narration path, every candidate's thumbnail path, provider, license text, and original URL. A first-pass timeout may return partial candidates; present them for review. If it returns `asset_retrieval_needs_human_decision`, stop and ask whether to retry later or create a new script review with fewer/refined phrases.
5. **Music review.** Call `openmontage_list_local_music`. Present only its returned title, artist, license, and source metadata. If no tracks are listed, state that no reviewable local music is available. Never download or infer rights for a track.
6. **Asset, narration, and optional music approval gate.** Wait for explicit approval that names one or more candidate IDs. A music choice must name one returned track ID and explicitly approve it; silence is allowed only when the requester chooses no music. The reviewer may request different search phrases or script changes; start a new script review rather than overwriting the prior project. On `abandon`, stop.
7. **Render.** Only after explicit selection approval, call `openmontage_render_approved_zero_key_montage` with `assets_approved: true` and exactly the approved candidate IDs. Include `music_track_id` and `music_approved: true` only for an explicitly approved library track. Present the local video path, FFprobe validation, and render warnings. Captions are burned from the locally generated SRT when the preflight reports them available.
8. **Video review.** Stop and wait for the verdict:
   - **`post`** → Stop. This profile has no publishing, sharing, or external-distribution capability. Hand the finished local draft back and say posting needs a separate explicitly approved step.
   - **`fix: <feedback>`** → Create a new script review with the feedback incorporated, then return to step 2. Never overwrite or delete the earlier draft.
   - **`abandon`** → Stop. No further generation calls. Nothing is cleaned up automatically.

## Boundaries

- Never call a publish, share, export, delete, provider-configuration, or shell tool on behalf of the requester.
- Never bypass the script approval, asset/narration approval, or final video-review gates.
- Never retry footage acquisition automatically, describe an adapter as down without evidence from the returned acquisition state, or fall back to text motion after a zero-key acquisition attempt. A partial result is still an asset-review state; no-result timeout is a human-decision state.
- Never describe public-source candidates as automatically licensed for every use: present their recorded source and license text for human review.
- Never add music automatically. Only a returned local-library track with declared license/source metadata and explicit approval may be mixed.
- Keep Obsidian read-only, same as the rest of this profile.
