# fix(#609): OpenRouter curation needs catalog dedup + Browse-models UX overhaul

## Context

PR #617's #609 claim adds an OpenRouter model catalog with per-model visibility checkboxes. In vbeta.18.36 smoke this is functional but unhelpful in practice:

1. **OpenRouter section duplicates authed-provider models.** The picker shows the same model under both "Authorized" (e.g. anthropic direct) and "OpenRouter" — even though the direct path is always preferred. Surfacing both is noise; the user has no reason to pick the aggregator route over the direct route they've already authed.

2. **OpenRouter section currently shows only DeepSeek** even though the curation panel has many more models toggled, OR the curation isn't actually filtering the picker, OR both. (Need to verify whether the filter is working at all.)

3. **Browse & curate panel UX is unusable at scale.**
   - 356 models, all pre-selected by default (overwhelming).
   - No sorting by price tier (especially "Free" vs paid).
   - No bulk select / bulk deselect / select-by-filter affordance.
   - No way to deselect everything and only opt-in to the few you actually want.

## Behavior we want

### Picker (composer)
- Aggregator routes (`openrouter`) should not duplicate models that the user has authed via a direct provider.
- Specifically: if the user has authed `anthropic`, the picker hides `openrouter/anthropic/claude-*` from the OpenRouter section (the direct route is shown in the authed section already).
- Same rule for `openai`, `google`, `github-copilot` direct routes.
- OpenRouter section then only shows providers / models the user CAN'T reach directly — DeepSeek, Mistral, Llama, Qwen, X-AI, etc. — limited to the user's curated visibility list.

### Browse & curate panel
- **Default state:** zero models selected. User opts in, not out.
- **Sorting:** at minimum by name, by price (cheapest first), by free / non-free, by context length.
- **Filter chip row:** "Free only", "$ ≤ $0.10/1M", "Vision-capable", etc.
- **Bulk actions:**
  - "Select all visible" / "Deselect all visible" (respects current filter)
  - "Reset to recommended starter set" (preselected curated list — small, e.g. DeepSeek-v3, Llama 3.3, Qwen 2.5)
- **Per-row:** keep the existing checkbox + price + context window display.

## Scope

Two areas:

### Server (api_server)
- `apps/api_server/src/routes/agents_models_routes.ts` — the `/agents/models/catalog` endpoint. Filter out aggregator routes whose `(provider, modelFamily)` pair is already in the user's authed-direct-route set.
- Add: when the user has not yet curated anything, return the "recommended starter" list as the default visibility instead of "all selected".

### Flutter
- The "Browse & curate models" dialog (likely in `apps/desktop_flutter/lib/features/agents/views/` near `ai_account_section.dart`). Add sorting / filtering / bulk-action UI.

## Acceptance criteria

- [ ] Composer picker: aggregator routes for already-authed providers are hidden. Only "exclusive to OpenRouter" models appear.
- [ ] Browse panel: opens with a sensible filter chip row + sort options.
- [ ] Bulk actions work and respect the current filter.
- [ ] Default visibility on first open is small (e.g. ≤10 curated picks) — not 356 / not 0.
- [ ] Existing #609 tests still pass; new tests cover the dedup + bulk-action behavior.
- [ ] No regression for users who have already curated their visibility set.

## Out of scope

- Letting the user pick the aggregator route deliberately even when direct is authed. (Some users may want to A/B compare. Add as a future "advanced" toggle.)

## Severity

Medium — feature exists but is not useful in current state. Doesn't block #617 merge (the data layer is right; this is mostly UX polish on top). File as a follow-up sprint of its own size.

---

## Additional finding — Composer 7 smoke (vbeta.18.36)

User curated **hundreds of models** as visible in the OpenRouter Manage panel. After saving, the composer model picker's OpenRouter section shows **only ~6 models** — covering only OpenAI, Anthropic, Google, and DeepSeek families. All other curated families (Mistral, Llama, Qwen, X-AI, Cohere, etc.) are silently absent from the picker.

Root cause hypothesis: the catalog endpoint or the Flutter picker is intersecting curated visibility with the hardcoded `ROUTE_FALLBACKS_BY_AGENT` list (which only has entries for `openai/*`, `anthropic/*`, `google/*` prefixes — plus DeepSeek by some other path the user is using). Anything not in those fallback lists gets dropped, even if curated. So curation only "works" for models that already had a hardcoded route entry — defeating the purpose of a curation feature for arbitrary OpenRouter models.

### Fix scope addition

- `apps/api_server/src/routes/agents_models_routes.ts` (the `/agents/models/catalog` endpoint): when assembling the OpenRouter section, source ALL curated-and-visible models from `agent_model_visibility`, not just intersect with the fallback list. Show every curated model in the picker regardless of whether the agent kind has a hardcoded fallback.
- For models not in the fallback list, derive a synthetic `agent_kind` from the modelId prefix (deepseek/* → opencode, mistralai/* → opencode, etc.) so the WS prompt flow can resolve them. The agent_kind labeling bug filed separately covers the pill text.

### Additional acceptance criteria

- [ ] Curate 50 random OpenRouter models from varied families → all 50 appear in the picker after save.
- [ ] Curated → uncurated → save → uncurated models removed from picker.
- [ ] Existing #609 test that asserts catalog response shape still passes; add a test covering the "curated model not in fallback list" path.
- [ ] **No duplicate rows in the OpenRouter section** — vbeta.18.36 smoke screenshot showed `anthropic/claude-sonnet-4.6` listed twice. Likely the fallback-list-merge step inserts the same modelId from two paths (e.g. claude-code agent fallback + opencode agent fallback both contain that route). Dedup by (provider, modelId) before rendering.
