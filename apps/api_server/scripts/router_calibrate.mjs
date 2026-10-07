#!/usr/bin/env node
// Rhythm router calibration: standalone, no dependencies (Node 18+).
//
// Sends 20 labelled prompts to a running reranker (llama-server --reranking) and scores
// them against Rhythm's three tier descriptions, exactly as the router does. Prints how
// often it picks the right tier and what to change so it does better.
//
//   node router_calibrate.mjs                               # llama-server on 127.0.0.1:8012
//   node router_calibrate.mjs --url http://127.0.0.1:8080   # other port
//   node router_calibrate.mjs --scale logit                 # if the server returns negative scores
//   node router_calibrate.mjs --json results.json           # also save everything as JSON
//   node router_calibrate.mjs --mode descriptions           # only method A (tier descriptions)
//   node router_calibrate.mjs --mode examples               # only method B (example prompts)
//   node router_calibrate.mjs --mode classifier             # only method C (small instruct LLM)
//   node router_calibrate.mjs --classifier-url http://127.0.0.1:8013   # where method C's model runs
//   node router_calibrate.mjs --mode systemone              # only method D (Kev locally, or hosted Jev)
//   node router_calibrate.mjs --systemone-url https://api.typesafe.ai   # method D against hosted Jev (needs JEV_API_KEY)
//   node router_calibrate.mjs --examples my_examples.json   # your own examples: {"cheap":[...],"standard":[...],"frontier":[...]}
//
// Default --mode all runs every method on the same prompts and compares them:
//   A  reranker vs the three tier DESCRIPTIONS (what Rhythm does today)
//   B  reranker vs ~10 EXAMPLE PROMPTS per tier (tier whose examples it resembles most)
//   C  a small instruction-following LLM asked "cheap, standard or frontier?", using the
//      probability it gives each answer as confidence. Needs a second llama-server (see below);
//      skipped automatically if it isn't running.
//   D  a System One decision model (Kev, open source, or TypeSafe's hosted Jev) asked one
//      typed "choice" question with the three tiers as options; its calibrated probabilities
//      are the confidence. Skipped automatically if it isn't running.
//
// Method C model (second terminal tab):
//   llama-server -hf unsloth/Qwen3-4B-Instruct-2507-GGUF:Q4_K_M --host 127.0.0.1 --port 8013 -c 4096
//
// Method D model, Kev (third tab; https://github.com/jaredpalmer/kev, needs uv):
//   git clone https://github.com/jaredpalmer/kev.git && cd kev && uv sync --extra serve
//   uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b --port 8009
// Hosted Jev instead: JEV_API_KEY=... node router_calibrate.mjs --mode systemone --systemone-url https://api.typesafe.ai
// (hosted Jev receives the 50 test prompts below; they are synthetic, no personal data)

import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE_URL = arg('url', 'http://127.0.0.1:8012').replace(/\/+$/, '');
const SCALE = arg('scale', 'auto'); // auto | probability | logit
const MIN_CONFIDENCE = Number(arg('min-confidence', '0.55')); // Rhythm's default
const JSON_OUT = arg('json', null);
const MODE = arg('mode', 'all'); // all | descriptions | examples | classifier  ('both' = A+B)
const CLASSIFIER_URL = arg('classifier-url', 'http://127.0.0.1:8013').replace(/\/+$/, '');
const runA = ['all', 'both', 'descriptions'].includes(MODE);
const runB = ['all', 'both', 'examples'].includes(MODE);
const runC = ['all', 'classifier'].includes(MODE);
const runD = ['all', 'systemone'].includes(MODE);
const SYSTEMONE_URL = arg('systemone-url', 'http://127.0.0.1:8009').replace(/\/+$/, '');
const SYSTEMONE_REMOTE = !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(SYSTEMONE_URL);
const SYSTEMONE_MODEL = arg('systemone-model', SYSTEMONE_REMOTE ? 'jev-latest' : 'kev-latest');
const SYSTEMONE_KEY = arg('api-key', process.env.JEV_API_KEY ?? '');
const EXAMPLES_FILE = arg('examples', null);
// Router budget: DEFAULT_SYSTEMONE_TIMEOUT_MS in src/services/decision/decision_settings.ts:72.
const DEFAULT_SYSTEMONE_TIMEOUT_MS = 1000;
const TOP_K = 3; // per-tier aggregation: mean of the tier's best 3 example scores

// Copied from apps/api_server/src/services/decision/model_router.ts (TIER_LABELS).
const TIERS = [
  { id: 'cheap', description: 'A quick, simple request: look something up, rename a symbol, fix formatting, give a short factual answer, or make a small single-file edit.' },
  { id: 'standard', description: 'A typical everyday coding, writing, or analysis task: implement a feature, fix a routine bug, write tests, review a change, explain code.' },
  { id: 'frontier', description: 'A hard task needing deep reasoning: multi-step planning, system architecture, difficult debugging, ambiguous judgement calls, or long research across many sources.' },
];
const TIER_RANK = { cheap: 0, standard: 1, frontier: 2 };

// Copied from apps/api_server/scripts/decision_calibrate/fixtures.ts.
const PROMPTS = [
  ['cheap', 'What tasks are due today?', 'single lookup'],
  ['cheap', 'Mark the bulletin proofread task as done.', 'one status change'],
  ['cheap', 'Is the Fellowship Hall free Friday at 6pm?', 'one availability check'],
  ['cheap', 'Rename the variable tmp to pendingReservation in facilities_controller.ts.', 'mechanical rename; wording resembles a code edit'],
  ['cheap', 'Fix the typo in the first line of this announcement: "Welcom to church".', 'trivial edit'],
  ['cheap', 'Here is the full text of our Easter weekend volunteer schedule, with roles, arrival times, contact numbers and parking notes for each of the four services. Please just tell me what time the 11am worship team call time is, nothing else. Sunday 9:00 setup crew, 9:30 tech check, 10:15 band rehearsal, 10:45 worship team call time for the 11am service, 11:00 doors.', 'LONG prompt but the answer is a single lookup'],
  ['cheap', 'Change the due date of the volunteer thank-you task to Friday.', 'one field update'],
  ['standard', 'Draft a friendly email to the volunteer team thanking them for Easter weekend and asking for feedback.', 'email drafting'],
  ['standard', "Summarize this week's message threads and list any follow-ups I owe people.", 'summarize plus extract'],
  ['standard', 'Pull the service plan from Planning Center and write a run-of-show for the tech team.', 'PCO fetch plus writing'],
  ['standard', 'Write a unit test for the recurring-rule parser that covers weekly and monthly cases.', 'routine test writing'],
  ['standard', 'Add a notes field to the reservation dialog and wire it to the API in the Flutter view.', 'single-feature implementation'],
  ['standard', "Plan next week's staff schedule around the two facility reservations and the Wednesday youth night.", 'weekly planning; "plan" overlaps frontier wording'],
  ['standard', 'The rhythms list shows duplicates after I edit a step. Find and fix the bug in rhythms_controller.dart.', 'routine bug; "bug" overlaps frontier wording'],
  ['frontier', 'Why does sync lose data?', 'SHORT but open-ended distributed-systems debugging'],
  ['frontier', 'Design how offline edits in the Flutter app should merge with the production Postgres API when two staff edit the same task, including conflict rules and a migration plan.', 'architecture with trade-offs'],
  ['frontier', 'Tasks created by the recurring-rule scheduler occasionally appear twice, only after the server restarts near midnight, and only for weekly rules. Find the root cause across the scheduler, repository and migrations.', 'difficult multi-file debugging'],
  ['frontier', 'Refactor the agent session layer so the local agent server and the production API share one auth and capability model without coupling their base URLs. Propose the plan, then outline the risks.', 'large refactor with planning'],
  ['frontier', 'Review our OAuth token storage for PCO and Google for security weaknesses and rank them by exploitability.', 'security review'],
  ['frontier', 'Should we consolidate Messages and email into one inbox, or keep them separate? Weigh staff workflows, the PCO integration and our small team before recommending.', 'ambiguous product judgement call'],
].map(([expected, prompt, why]) => ({ expected, prompt, why }));

// Example prompts per tier. Deliberately DIFFERENT from the 20 test prompts above, so the
// test is fair (the router never sees a test prompt among its examples).
let EXAMPLES = {
  cheap: [
    "What's on my calendar tomorrow morning?",
    "Delete the duplicate 'order coffee' task.",
    'How many open tasks do I have?',
    'Move the youth trip planning task to next Tuesday.',
    'Who is scheduled to run sound this Sunday?',
    "Rename the 'Misc' project to 'Building maintenance'.",
    "Correct the spelling of 'recieve' in the welcome email.",
    'Is the chapel booked Saturday afternoon?',
    "Change the button label from 'Submit' to 'Save' in settings_view.dart.",
    'Remove the unused import at the top of tasks_repository.dart.',
  ],
  standard: [
    'Write a short announcement for Sunday about the new parking lot rules.',
    'Turn these meeting notes into a task list with owners and due dates.',
    "Draft a reply to Pastor Mike's email about the budget meeting, keep it friendly.",
    'Create a recurring rhythm for weekly volunteer check-in calls.',
    'Add a filter to the tasks view so I can show only overdue items.',
    'Write a Jest test for the facilities reservation endpoint.',
    'Explain what this migration function does and whether it is safe to run twice.',
    "Compare this month's facility bookings to last month and summarize the changes.",
    'Fix the date picker so it shows the week starting on Sunday.',
    'Set up a project template for Vacation Bible School with the usual steps.',
  ],
  frontier: [
    "Design a permissions model so campus pastors see only their campus's tasks, facilities and messages.",
    'Messages sometimes arrive out of order on mobile but not desktop. Figure out why across the relay, websocket and database layers.',
    'Plan a migration from SQLite to Postgres for the local agent server without downtime or data loss.',
    'Evaluate whether we should build our own scheduling engine or integrate with Planning Center more deeply, and recommend one.',
    'Audit the API for places where one user could read another user\'s data.',
    'Our API memory usage grows until it crashes after a few days. Find the leak.',
    'Propose an architecture for syncing Rhythm tasks with Google Tasks both ways, including conflict handling.',
    'Research how other church management tools handle volunteer burnout signals and propose what we should track.',
    'Restructure the monorepo build so the desktop, mobile and API share types without circular dependencies.',
    'Decide how to price and package Rhythm for other churches, weighing support load, hosting costs and our mission.',
  ],
};

// ---------------------------------------------------------------------------

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
let sawRawOutsideUnit = false;

function normalise(raw) {
  if (raw.some((v) => v < 0 || v > 1)) sawRawOutsideUnit = true;
  if (SCALE === 'logit') return raw.map(sigmoid);
  if (SCALE === 'probability') return raw.map((v) => Math.min(1, Math.max(0, v)));
  return raw.every((v) => v >= 0 && v <= 1) ? raw : raw.map(sigmoid);
}

async function rerank(query, documents) {
  const started = performance.now();
  const res = await fetch(`${BASE_URL}/v1/rerank`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, documents, top_n: documents.length }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const items = body.results ?? body.data ?? body;
  const raw = new Array(documents.length).fill(0);
  for (const it of items) raw[it.index] = it.relevance_score ?? it.score;
  return { scores: normalise(raw), raw, latencyMs: performance.now() - started };
}

const pct = (x) => `${Math.round(x * 100)}%`;
const f3 = (x) => x.toFixed(3);
const pad = (s, n) => String(s).padEnd(n);
const STOP = new Set('a an and or the of to in on for with this that is are be it as at by from our we you your i me my do does should can how why what when which into across then just only each any all new next'.split(' '));
const tokens = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));

function sweep(rows, key) {
  const out = [];
  for (let t = 0; t <= 0.951; t += 0.05) {
    const applied = rows.filter((r) => r[key] >= t);
    const correct = applied.filter((r) => r.correct).length;
    out.push({ t: Number(t.toFixed(2)), coverage: applied.length / rows.length, accuracy: applied.length ? correct / applied.length : null, n: applied.length });
  }
  return out;
}
const firstAt = (sw, target) => sw.find((s) => s.accuracy !== null && s.accuracy >= target && s.n >= 3);

// ---- classifiers ----------------------------------------------------------

// Rhythm's current method: score the prompt against the three tier descriptions.
async function classifyByDescriptions(prompt) {
  const { scores, raw, latencyMs } = await rerank(prompt, TIERS.map((t) => t.description));
  const tierScores = Object.fromEntries(TIERS.map((t, i) => [t.id, scores[i]]));
  return { tierScores, raw, latencyMs, nearest: null };
}

// Example-prompt method: score the prompt against every example, then per tier take the
// mean of that tier's best TOP_K scores. The tier whose examples it resembles most wins.
async function classifyByExamples(prompt, bank) {
  const docs = [];
  for (const t of TIERS) for (const ex of bank[t.id]) docs.push({ tier: t.id, text: ex });
  const { scores, raw, latencyMs } = await rerank(prompt, docs.map((d) => d.text));
  const tierScores = {};
  for (const t of TIERS) {
    const mine = docs.map((d, i) => (d.tier === t.id ? scores[i] : null)).filter((v) => v !== null).sort((a, b) => b - a);
    const top = mine.slice(0, TOP_K);
    tierScores[t.id] = top.reduce((a, b) => a + b, 0) / (top.length || 1);
  }
  const best = scores.map((sc, i) => ({ sc, i })).sort((a, b) => b.sc - a.sc)[0];
  return { tierScores, raw, latencyMs, nearest: { tier: docs[best.i].tier, text: docs[best.i].text, score: best.sc } };
}

// Method C: ask a small instruct model to pick A/B/C and read the probability of each letter.
// Letters are single tokens, so the first generated token's top_logprobs give a clean
// three-way distribution. Zero-shot (no examples in the prompt), so all 50 prompts are fair.
const LETTER = { A: 'cheap', B: 'standard', C: 'frontier' };
const CLASSIFIER_SYSTEM = [
  'You route requests for a church-staff productivity app with a coding assistant to the cheapest AI model tier that can do the job well.',
  'A = cheap: ' + TIERS[0].description,
  'B = standard: ' + TIERS[1].description,
  'C = frontier: ' + TIERS[2].description,
  'Judge by how much reasoning the task needs, not by its length or its topic. A long request can still be a simple lookup; a short question can hide a hard problem.',
  'Answer with exactly one letter: A, B or C.',
].join('\n');

// ---- probability validation (mirrors production; failed rows are NOT predictions) ----------
// Mirrors systemone_client.ts parseAnswer (lines ~142-163) and model_router.ts classifyWithChoice
// (lines ~46-75): every tier must be a finite number >= 0, the sum must be finite and > 0, values
// are divided by the sum, each must land in [0,1], and the total must be within 1e-6 of 1. The
// `choice` label is never evidence of confidence. Not importable from .mjs without a TS build.
const MALFORMED = { failed: true, reason: 'malformed_response' };
export function normalizeTierProbs(raw, ids = ['cheap', 'standard', 'frontier']) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return MALFORMED;
  const probs = {};
  let sum = 0;
  for (const id of ids) {
    const v = raw[id];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return MALFORMED;
    probs[id] = v;
    sum += v;
  }
  if (!Number.isFinite(sum) || sum <= 0) return MALFORMED; // MAX_VALUE + MAX_VALUE overflows here
  let total = 0;
  for (const id of ids) {
    probs[id] /= sum;
    if (!Number.isFinite(probs[id]) || probs[id] < 0 || probs[id] > 1) return MALFORMED;
    total += probs[id];
  }
  if (Math.abs(total - 1) > 1e-6) return MALFORMED;
  return { probs };
}

// Method D: the answer object (body.answers.tier). Missing/partial/zero-sum probabilities fail; no one-hot from `choice`.
export function tierProbsFromSystemOne(answer) {
  if (!answer || typeof answer !== 'object') return MALFORMED;
  return normalizeTierProbs(answer.probabilities);
}

// Method C: first generated token's top_logprobs. All three letters must be present with
// finite logprob <= 0; a generated letter without logprobs is never promoted to probability 1.
export function tierProbsFromLogprobs(choice) {
  const cands = choice?.logprobs?.content?.[0]?.top_logprobs;
  if (!Array.isArray(cands)) return MALFORMED;
  const raw = {};
  for (const cand of cands) {
    const id = LETTER[String(cand?.token ?? '').trim().toUpperCase()];
    if (!id) continue;
    if (typeof cand.logprob !== 'number' || !Number.isFinite(cand.logprob) || cand.logprob > 0) return MALFORMED;
    raw[id] = (raw[id] ?? 0) + Math.exp(cand.logprob);
  }
  return normalizeTierProbs(raw);
}

// Failed rows are non-predictions: counted and reported separately, never dropped or scored as misses.
export function summarizeRows(rows) {
  const total = rows.length;
  const failed = rows.filter((r) => r.failed).length;
  const predicted = total - failed;
  const correct = rows.filter((r) => !r.failed && r.correct).length;
  return {
    total, predicted, failed, correct,
    accuracyOfPredicted: predicted ? correct / predicted : null,
    accuracyOfAll: total ? correct / total : null,
  };
}


async function classifyByLLM(prompt) {
  const started = performance.now();
  const res = await fetch(`${CLASSIFIER_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: CLASSIFIER_SYSTEM },
        { role: 'user', content: `Request:\n<request>\n${prompt}\n</request>\n\nWhich tier? Answer A, B or C.` },
      ],
      max_tokens: 1,
      temperature: 0,
      logprobs: true,
      top_logprobs: 10,
      chat_template_kwargs: { enable_thinking: false }, // Qwen3 hybrid models: skip the <think> block
    }),
  });
  if (!res.ok) throw new Error(`classifier HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const choice = body.choices?.[0] ?? {};
  const v = tierProbsFromLogprobs(choice);
  const latencyMs = performance.now() - started;
  if (v.failed) return { failed: true, reason: v.reason, latencyMs };
  return { tierScores: v.probs, raw: null, latencyMs, nearest: null };
}

// Method D: one typed choice question, options = the three tiers (System One /v1/systemone).
let systemoneModel = null;
async function classifyBySystemOne(prompt) {
  const started = performance.now();
  const headers = { 'content-type': 'application/json' };
  if (SYSTEMONE_KEY) headers.authorization = `Bearer ${SYSTEMONE_KEY}`;
  const res = await fetch(`${SYSTEMONE_URL}/v1/systemone`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: SYSTEMONE_MODEL,
      state: prompt,
      questions: {
        tier: {
          type: 'choice',
          instructions: 'This is a request sent to an AI assistant. Which model tier does it need? Judge by how much reasoning the task needs, not by its length or its topic. A long request can still be a simple lookup; a short question can hide a hard problem.',
          criteria: Object.fromEntries(TIERS.map((t) => [t.id, t.description])),
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`systemone HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  systemoneModel = body.model ?? systemoneModel;
  const answer = body.answers?.tier ?? (Array.isArray(body.answers) ? body.answers[0] : null);
  const v = tierProbsFromSystemOne(answer);
  const latencyMs = performance.now() - started;
  if (v.failed) return { failed: true, reason: v.reason, latencyMs };
  return { tierScores: v.probs, raw: null, latencyMs, nearest: null };
}

function toRow(p, result) {
  if (result.failed) return { ...p, failed: true, reason: result.reason, latencyMs: result.latencyMs, correct: false };
  const ranked = Object.entries(result.tierScores).map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
  const sum = ranked.reduce((a, r) => a + r.score, 0) || 1;
  return {
    ...p,
    picked: ranked[0].id,
    confidence: ranked[0].score,
    margin: ranked[0].score - ranked[1].score,
    share: ranked[0].score / sum,
    scores: result.tierScores,
    nearest: result.nearest,
    latencyMs: result.latencyMs,
    correct: ranked[0].id === p.expected,
    failed: false,
  };
}

// ---- report ---------------------------------------------------------------

function report(title, allRows, { showDescriptionBlame }) {
  console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
  const sum = summarizeRows(allRows);
  const failedRows = allRows.filter((r) => r.failed);
  const rows = allRows.filter((r) => !r.failed);
  if (failedRows.length) {
    console.log(`\n   FAILED (non-predictions, excluded from accuracy below): ${failedRows.length}/${sum.total} — malformed_response`);
    for (const r of failedRows) console.log(`   ! ${r.reason}  ${r.prompt.slice(0, 64)}`);
    console.log(`   Accuracy counting failures as misses: ${pct(sum.accuracyOfAll)} (${sum.correct}/${sum.total})`);
  }

  console.log('\n1) PER PROMPT  (✓ right tier, ✗ wrong)');
  console.log(`   ${pad('expected', 9)}${pad('picked', 9)}${pad('conf', 7)}${pad('margin', 8)}${pad('share', 7)}  prompt`);
  for (const r of rows) {
    console.log(` ${r.correct ? '✓' : '✗'} ${pad(r.expected, 9)}${pad(r.picked, 9)}${pad(f3(r.confidence), 7)}${pad(f3(r.margin), 8)}${pad(f3(r.share), 7)}  ${r.prompt.slice(0, 64)}${r.prompt.length > 64 ? '…' : ''}${r.source === 'loo' ? '  [example, held out]' : ''}`);
  }

  const n = rows.length;
  if (!n) { console.log('\n   No usable predictions.'); return { rows, n: 0, accuracy: 0, over: 0, under: 0, confPick: null, sharePick: null, avgMs: 0, confSweep: [], shareSweep: [], marginSweep: [], failed: failedRows.length, total: sum.total }; }
  const nOk = rows.filter((r) => r.correct).length;
  console.log(`\n2) ACCURACY  overall ${pct(nOk / n)} (${nOk}/${n})   [random guessing ≈ 33%]`);
  for (const t of TIERS) {
    const tr = rows.filter((r) => r.expected === t.id);
    console.log(`   ${pad(t.id, 9)} ${pct(tr.filter((r) => r.correct).length / tr.length)}  (${tr.filter((r) => r.correct).length}/${tr.length})`);
  }
  console.log('\n   Confusion (rows = expected, cols = picked)');
  console.log(`   ${pad('', 10)}${TIERS.map((t) => pad(t.id, 10)).join('')}`);
  for (const e of TIERS) console.log(`   ${pad(e.id, 10)}${TIERS.map((pk) => pad(rows.filter((r) => r.expected === e.id && r.picked === pk.id).length, 10)).join('')}`);

  const confSweep = sweep(rows, 'confidence');
  const shareSweep = sweep(rows, 'share');
  const marginSweep = sweep(rows, 'margin');
  console.log('\n3) THRESHOLD SWEEP  (coverage = how often the router acts; accuracy = how often it is right when it acts)');
  console.log(`   ${pad('thresh', 8)}${pad('conf: cov/acc', 18)}${pad('share: cov/acc', 18)}margin: cov/acc`);
  for (let i = 0; i < confSweep.length; i++) {
    const cell = (x) => pad(`${pct(x.coverage)} / ${x.accuracy === null ? '-' : pct(x.accuracy)}`, 18);
    console.log(`   ${pad(confSweep[i].t.toFixed(2), 8)}${cell(confSweep[i])}${cell(shareSweep[i])}${cell(marginSweep[i]).trim()}`);
  }

  console.log('\n4) DIAGNOSTICS');
  const maxTop = Math.max(...rows.map((r) => r.confidence));
  console.log(`   Highest top score: ${f3(maxTop)}`);
  const over = rows.filter((r) => TIER_RANK[r.picked] > TIER_RANK[r.expected]);
  const under = rows.filter((r) => TIER_RANK[r.picked] < TIER_RANK[r.expected]);
  console.log(`   Over-routed (pricier tier than needed → wastes money): ${over.length}`);
  console.log(`   Under-routed (weaker tier than needed → quality risk): ${under.length}`);
  const misses = rows.filter((r) => !r.correct);
  if (misses.length && showDescriptionBlame) {
    const blame = {};
    for (const r of misses) {
      const winner = TIERS.find((t) => t.id === r.picked);
      for (const w of [...tokens(r.prompt)].filter((x) => tokens(winner.description).has(x))) (blame[r.picked] ??= {})[w] = ((blame[r.picked] ?? {})[w] ?? 0) + 1;
    }
    for (const [tier, words] of Object.entries(blame)) {
      const top = Object.entries(words).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w]) => `'${w}'`);
      if (top.length) console.log(`   → The ${tier} description over-matches on ${top.join(', ')}.`);
    }
  }
  if (misses.length && !showDescriptionBlame) {
    console.log('\n   Misrouted prompts and the example that pulled them the wrong way (fix: reword/move that example, or add one closer to the prompt):');
    for (const r of misses) {
      if (!r.nearest) continue;
      console.log(`   • [${r.expected}→${r.picked}] "${r.prompt.slice(0, 50)}${r.prompt.length > 50 ? '…' : ''}"`);
      console.log(`       nearest example (${r.nearest.tier}): "${r.nearest.text.slice(0, 70)}${r.nearest.text.length > 70 ? '…' : ''}"`);
    }
  }

  console.log('\n5) WHAT TO SET');
  const confPick = firstAt(confSweep, 0.9);
  const sharePick = firstAt(shareSweep, 0.9);
  if (confPick) console.log(`   Raw confidence ≥ ${confPick.t.toFixed(2)} → ${pct(confPick.accuracy)} right on ${pct(confPick.coverage)} of prompts.`);
  if (sharePick) console.log(`   Share ≥ ${sharePick.t.toFixed(2)} → ${pct(sharePick.accuracy)} right on ${pct(sharePick.coverage)} of prompts (${sharePick.n} prompts).`);
  if (!confPick && !sharePick) console.log('   No threshold reaches 90% accuracy on at least 3 prompts. Keep Model routing in Shadow for this method.');
  const avgMs = rows.reduce((a, r) => a + r.latencyMs, 0) / n;
  console.log(`   Latency: avg ${Math.round(avgMs)} ms per decision (Rhythm's router timeout is ${DEFAULT_SYSTEMONE_TIMEOUT_MS} ms by default).`);

  return { rows, failed: failedRows.length, total: sum.total, n, accuracy: nOk / n, over: over.length, under: under.length, confPick, sharePick, avgMs, confSweep, shareSweep, marginSweep };
}

// ---- main -----------------------------------------------------------------

async function main() {
  console.log(`Rhythm router calibration → ${BASE_URL}  (score scale: ${SCALE}, mode: ${MODE})`);
  if (runA || runB) try {
    await rerank('ping', ['pong']);
  } catch (err) {
    console.error(`Can't reach the reranker at ${BASE_URL}: ${err.message}`);
    console.error('Start it with:  llama-server -hf <gguf> --reranking --host 127.0.0.1 --port 8012 -c 8192 -ub 8192');
    process.exit(1);
  }
  if (EXAMPLES_FILE) {
    const { readFileSync } = await import('node:fs');
    EXAMPLES = JSON.parse(readFileSync(EXAMPLES_FILE, 'utf8'));
    for (const t of TIERS) if (!Array.isArray(EXAMPLES[t.id]) || EXAMPLES[t.id].length < TOP_K) throw new Error(`--examples needs at least ${TOP_K} examples for "${t.id}"`);
  }
  const summary = {};
  const out = {};

  if (runA) {
    const rows = [];
    for (const p of PROMPTS) rows.push(toRow(p, await classifyByDescriptions(p.prompt)));
    summary.descriptions = report('METHOD A: tier DESCRIPTIONS (what Rhythm does today)', rows, { showDescriptionBlame: true });
    out.descriptions = rows;
    if (sawRawOutsideUnit && SCALE !== 'logit') console.log('\n   ⚠ The server returned scores outside 0–1 (logits). Re-run with --scale logit.');
  }

  if (runB) {
    process.stdout.write('\nScoring against example prompts');
    const rows = [];
    for (const p of PROMPTS) { rows.push({ ...toRow(p, await classifyByExamples(p.prompt, EXAMPLES)), source: 'test' }); process.stdout.write('.'); }
    // Leave-one-out over the examples themselves: each example is classified by all the OTHERS.
    // Doubles the sample size (more trustworthy threshold) without ever letting a prompt see itself.
    for (const t of TIERS) {
      for (const ex of EXAMPLES[t.id]) {
        const bank = Object.fromEntries(TIERS.map((u) => [u.id, EXAMPLES[u.id].filter((e) => e !== ex)]));
        rows.push({ ...toRow({ expected: t.id, prompt: ex, why: 'example (held out)' }, await classifyByExamples(ex, bank)), source: 'loo' });
        process.stdout.write('.');
      }
    }
    process.stdout.write('\n');
    const testRows = rows.filter((r) => r.source === 'test');
    summary.examples = report(`METHOD B: EXAMPLE PROMPTS (${TOP_K}-best mean per tier), 20 test prompts`, testRows, { showDescriptionBlame: false });
    summary.examplesAll = report(`METHOD B, all ${rows.length} prompts (20 test + ${rows.length - 20} examples each held out) — use this sweep to pick a threshold`, rows, { showDescriptionBlame: false });
    out.examples = rows;
  }

  if (runC) {
    let reachable = true;
    try { await classifyByLLM('What tasks are due today?'); } catch (err) {
      reachable = false;
      console.log(`\nMETHOD C skipped: no instruct model at ${CLASSIFIER_URL} (${err.message}).`);
      console.log('   Start one in another tab, then re-run:');
      console.log('   llama-server -hf unsloth/Qwen3-4B-Instruct-2507-GGUF:Q4_K_M --host 127.0.0.1 --port 8013 -c 4096');
    }
    if (reachable) {
      process.stdout.write('\nAsking the classifier model');
      const rows = [];
      for (const p of PROMPTS) { rows.push({ ...toRow(p, await classifyByLLM(p.prompt)), source: 'test' }); process.stdout.write('.'); }
      for (const t of TIERS) for (const ex of EXAMPLES[t.id]) { rows.push({ ...toRow({ expected: t.id, prompt: ex, why: 'example' }, await classifyByLLM(ex)), source: 'extra' }); process.stdout.write('.'); }
      process.stdout.write('\n');
      const cFailed = rows.filter((r) => r.failed).length;
      if (cFailed) console.log(`   ⚠ ${cFailed}/${rows.length} classifier rows had missing/partial logprobs and were recorded as failed (no 0/1 fallback). Update llama.cpp (brew upgrade llama.cpp) if this is most rows.`);
      summary.classifier = report('METHOD C: small instruct LLM, 20 test prompts', rows.filter((r) => r.source === 'test'), { showDescriptionBlame: false });
      summary.classifierAll = report(`METHOD C, all ${rows.length} prompts (zero-shot, so every prompt is held out) — use this sweep to pick a threshold`, rows, { showDescriptionBlame: false });
      out.classifier = rows;
    }
  }

  if (runD) {
    let reachable = true;
    if (SYSTEMONE_REMOTE && !SYSTEMONE_KEY) {
      reachable = false;
      console.log(`\nMETHOD D skipped: ${SYSTEMONE_URL} is remote and no key was given. Set JEV_API_KEY or pass --api-key.`);
    } else {
      try { await classifyBySystemOne('What tasks are due today?'); } catch (err) {
        reachable = false;
        console.log(`\nMETHOD D skipped: no System One model at ${SYSTEMONE_URL} (${err.message}).`);
        console.log('   Start Kev in another tab, then re-run:');
        console.log('   git clone https://github.com/jaredpalmer/kev.git && cd kev && uv sync --extra serve');
        console.log('   uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b --port 8009');
      }
    }
    if (reachable) {
      process.stdout.write(`\nAsking the System One model (${SYSTEMONE_MODEL} at ${SYSTEMONE_URL})`);
      const rows = [];
      for (const p of PROMPTS) { rows.push({ ...toRow(p, await classifyBySystemOne(p.prompt)), source: 'test' }); process.stdout.write('.'); }
      for (const t of TIERS) for (const ex of EXAMPLES[t.id]) { rows.push({ ...toRow({ expected: t.id, prompt: ex, why: 'example' }, await classifyBySystemOne(ex)), source: 'extra' }); process.stdout.write('.'); }
      process.stdout.write('\n');
      if (systemoneModel) console.log(`   Served by: ${systemoneModel}`);
      summary.systemone = report('METHOD D: System One decision model (Kev/Jev), 20 test prompts', rows.filter((r) => r.source === 'test'), { showDescriptionBlame: false });
      summary.systemoneAll = report(`METHOD D, all ${rows.length} prompts (zero-shot, so every prompt is held out) — use this sweep to pick a threshold`, rows, { showDescriptionBlame: false });
      out.systemone = rows;
    }
  }

  const methods = [
    ['A descriptions', summary.descriptions, null],
    ['B examples', summary.examples, summary.examplesAll],
    ['C classifier', summary.classifier, summary.classifierAll],
    ['D system one', summary.systemone, summary.systemoneAll],
  ].filter(([, s20]) => s20);
  if (methods.length > 1) {
    console.log(`\n${'='.repeat(78)}\nHEAD TO HEAD\n${'='.repeat(78)}`);
    console.log(`   ${pad('', 18)}${pad('acc (20)', 11)}${pad('acc (50)', 11)}${pad('over/under', 13)}${pad('latency', 10)}90%-accurate threshold (50)`);
    for (const [name, s20, s50] of methods) {
      const pick = s50?.sharePick;
      console.log(`   ${pad(name, 18)}${pad(pct(s20.accuracy), 11)}${pad(s50 ? pct(s50.accuracy) : '-', 11)}${pad(`${s20.over}/${s20.under}`, 13)}${pad(`${Math.round(s20.avgMs)} ms`, 10)}${pick ? `share ≥ ${pick.t.toFixed(2)} → acts on ${pct(pick.coverage)}` : 'none'}`);
    }
    console.log('\n   VERDICT');
    const cands = [['classifier model (C)', summary.classifierAll], ['System One model (D)', summary.systemoneAll]].filter(([, s]) => s);
    cands.sort((a, b) => b[1].accuracy - a[1].accuracy);
    const [bestName, c] = cands[0] ?? [null, null];
    const frontierRecall = (s) => {
      const f = (s?.rows ?? []).filter((r) => r.expected === 'frontier');
      return f.length ? f.filter((r) => r.picked === 'frontier').length / f.length : null;
    };
    const fr = frontierRecall(c);
    if (c && c.accuracy >= 0.75 && c.sharePick && c.sharePick.coverage >= 0.4 && (fr === null || fr >= 0.6)) {
      console.log(`   The ${bestName} works. Tell Claude: "switch the router to the ${bestName}, confidence ≥ ${c.sharePick.t.toFixed(2)}".`);
    } else if (c && c.accuracy >= 0.65) {
      console.log(`   The ${bestName} is the most promising but not reliable yet${fr !== null ? ` (frontier recall ${pct(fr)})` : ''}. Try a bigger model (Kev-9B / 8B instruct), or tell Claude which misroutes look wrong to you — the labels or tier descriptions may need adjusting.`);
    } else if (c) {
      console.log('   None of the methods is reliable. Options: a bigger model, hosted Jev, or skip automatic tiering and keep capacity routing only.');
    } else {
      console.log('   Start the classifier (C) or Kev (D) model (see above) and re-run to compare.');
    }
    const slow = methods.filter(([, s20]) => s20.avgMs > DEFAULT_SYSTEMONE_TIMEOUT_MS).map(([n]) => n);
    if (slow.length) console.log(`   ⚠ Over Rhythm's ${DEFAULT_SYSTEMONE_TIMEOUT_MS} ms timeout: ${slow.join(', ')}. With "first prompt" routing that is once per chat, so raising the timeout is reasonable.`);
  }

  if (JSON_OUT) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(JSON_OUT, JSON.stringify({ baseUrl: BASE_URL, scale: SCALE, tiers: TIERS, examples: EXAMPLES, results: out }, null, 2));
    console.log(`\nSaved ${JSON_OUT}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err); process.exit(1); });
