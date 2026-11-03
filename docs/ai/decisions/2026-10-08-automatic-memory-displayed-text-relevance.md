---
date: 2026-10-08
tags: [decision, rhythm, memory]
---

# Automatic memory is admitted on the text actually injected

## Context

A private audit of 71 injected human turns rated 45 as having no useful task-specific
context, 14 weak and 12 useful. Replaying them through the deployed build reproduced
53/71 blocks byte-for-byte. Every injected item came through one gap: a semantic hit with
an excerpt skipped all relevance checks, and Engraph's `score`/`confidence` are
rank-relative (the top hit is always 100), so they cannot be thresholds. The lexical gate
scored whole note bodies, so a 20 KB chat archive matched almost anything. Short
follow-ups ("resume", "yes") searched with their own words.

## Decision

- One admission rule for every lane: at least 2 distinct content words shared between
  the request evidence and what the model will see (the sentence-aligned excerpt plus,
  for atomic notes, the note title). Broad notes (log, index, synthesis, dated/import
  context, archive-tagged) need 3 and get no title credit. Excerpts must have at least 2
  words of their own.
- Engraph's rank orders admitted notes; overlap only admits.
- A message with fewer than 6 content words uses up to two recent substantive user
  messages as relevance evidence. Retrieval still searches only the current message
  (Engraph latency grows with query length). No usable prior and fewer than 3 content
  words means no retrieval.
- Budgets (2 items, 1,200 characters), header and untrusted fence are unchanged; each
  item shows its kind and updated date.
- Per-turn, body-free receipts (`agent_memory_turn_receipts`, SQLite-only, newest 200 per
  session) record mode, decision, semantic status and candidate reasons.

## Alternatives

- Calibrated thresholds on Engraph scores: not possible (rank-relative).
- Corpus IDF weighting: on 776 notes, ordinary English words look rare and coincidental
  matches pass.
- Sending the prior message to Engraph as part of the query: kept useful leads but tripled
  semantic timeouts and moved median memory latency from about 325 ms to the 500 ms
  budget under load.
- An LLM/decision-model relevance judge: the best quality option, but either too slow
  locally on the critical path or it sends memory text to a remote service; needs AJ's
  decision.

## Consequences

On a private 115-turn evaluation (judged by hand), turns injecting only irrelevant
context fell from 63 to 32 and turns with a useful lead stayed about the same (20 -> 19),
with memory latency near baseline. Lexical overlap cannot see paraphrase: preferences
that live only inside broad archives (for example a writing-style profile) or that share
just one word with the request are missed. Promoting such preferences to their own
atomic notes, or an opt-in decision-model judge, are the follow-ups.
