/**
 * Decision-engine evaluation bench.
 *
 *   npx tsx scripts/decision_bench.ts [--base-url http://127.0.0.1:8012]
 *     [--model qwen3-reranker-4b] [--feature all|model_routing|tool_ranking|memory_ranking]
 *     [--json out.json] [--score-scale auto|probability|logit] [--timeout-ms 30000] [--fake]
 *
 * --fake uses an in-process token-overlap scorer to smoke-test the pipeline
 * (its numbers say nothing about model quality).
 */
import fs from 'node:fs';

import { HttpRerankClient, type RerankClient, type RerankResult } from '../src/services/decision/decision_client';
import { classify, rankCandidates } from '../src/services/decision/decision_engine';
import { getDecisionMemoryMinScore, type DecisionScoreScale } from '../src/config/env';
import {
  ece,
  mean,
  ndcg,
  percentile,
  precisionRecallAtThreshold,
  recallAtK,
  reciprocalRank,
  type ReliabilityBin,
} from './decision_bench/metrics';
import {
  MEMORY_BANK,
  MEMORY_FIXTURES,
  ROUTING_FIXTURES,
  TOOL_FIXTURES,
  TOOL_SERVERS,
  type Tier,
} from './decision_bench/fixtures';

type Feature = 'model_routing' | 'tool_ranking' | 'memory_ranking';
const ALL_FEATURES: Feature[] = ['model_routing', 'tool_ranking', 'memory_ranking'];
const SETUP_DOC = 'docs/ai/decision-engine-setup.md';

// keep in sync with model_router.ts (prefers the production export when present)
const LOCAL_TIER_LABELS: { id: Tier; description: string }[] = [
  { id: 'cheap', description: 'Simple, short request: a lookup, a quick status check, a single small edit, a yes/no question, or a routine formatting or rewording task that needs no deep reasoning.' },
  { id: 'standard', description: 'Ordinary multi-step work: drafting emails or documents, summarizing, planning a schedule, using a few tools together, or making a moderate code change in a single file.' },
  { id: 'frontier', description: 'Hard, open-ended or high-stakes work: architecture and design decisions, debugging subtle multi-file problems, large refactors, security review, complex analysis or long-horizon planning that needs careful reasoning.' },
];

function loadTierLabels(): { labels: { id: Tier; description: string }[]; source: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../src/services/decision/model_router') as { TIER_LABELS?: unknown };
    if (Array.isArray(mod.TIER_LABELS) && mod.TIER_LABELS.length > 0) {
      return { labels: mod.TIER_LABELS as { id: Tier; description: string }[], source: 'model_router.ts' };
    }
  } catch {
    /* not present yet */
  }
  return { labels: LOCAL_TIER_LABELS, source: 'bench-local (TODO: keep in sync with model_router.ts)' };
}

// ---- args ----
interface Args {
  baseUrl: string;
  model: string;
  feature: 'all' | Feature;
  json?: string;
  fake: boolean;
  timeoutMs: number;
  scoreScale?: DecisionScoreScale;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { baseUrl: 'http://127.0.0.1:8012', model: 'qwen3-reranker-4b', feature: 'all', fake: false, timeoutMs: 30000 };
  const val = (i: number, flag: string) => {
    if (i + 1 >= argv.length) fail(`Missing value for ${flag}`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--base-url': a.baseUrl = val(i++, '--base-url'); break;
      case '--model': a.model = val(i++, '--model'); break;
      case '--feature': {
        const f = val(i++, '--feature');
        if (f !== 'all' && !(ALL_FEATURES as string[]).includes(f)) fail(`Unknown feature ${f}`);
        a.feature = f as Args['feature'];
        break;
      }
      case '--json': a.json = val(i++, '--json'); break;
      case '--timeout-ms': a.timeoutMs = Number(val(i++, '--timeout-ms')) || 30000; break;
      case '--score-scale': {
        const s = val(i++, '--score-scale');
        if (s !== 'auto' && s !== 'probability' && s !== 'logit') fail(`Unknown score scale ${s}`);
        a.scoreScale = s;
        break;
      }
      case '--fake': a.fake = true; break;
      default: fail(`Unknown argument ${argv[i]}`);
    }
  }
  return a;
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

// ---- fake scorer ----
const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'or', 'for', 'in', 'on', 'is', 'are', 'my', 'me', 'i', 'we', 'it', 'this', 'that', 'what', 'how', 'with', 'at', 'do', 'does', 'be', 'by', 'from']);
const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t)));

class FakeRerankClient implements RerankClient {
  async rerank(query: string, documents: string[]): Promise<RerankResult> {
    const q = tokens(query);
    const scores = documents.map((d) => {
      let common = 0;
      for (const t of tokens(d)) if (q.has(t)) common++;
      return common / (common + 1.5);
    });
    return { status: 'ok', scores, latencyMs: 0, model: 'fake-token-overlap' };
  }
}

// ---- result types ----
interface Calibration { ece: number; bins: ReliabilityBin[]; n: number }
interface Latency { p50: number; p95: number; max: number; n: number }
interface FeatureResult {
  feature: Feature;
  cases: number;
  failures: number;
  metrics: Record<string, number>;
  latency: Latency;
  calibration: Calibration;
  details: unknown[];
}

const latencyOf = (xs: number[]): Latency => ({ p50: percentile(xs, 50), p95: percentile(xs, 95), max: xs.length ? Math.max(...xs) : 0, n: xs.length });
const calibrationOf = (s: { confidence: number; correct: boolean }[]): Calibration => ({ ...ece(s, 5), n: s.length });

// ---- feature runners ----
async function runRouting(client: RerankClient, timeoutMs: number): Promise<FeatureResult> {
  const { labels, source } = loadTierLabels();
  console.log(`  tier labels: ${source}`);
  const lat: number[] = [];
  const cal: { confidence: number; correct: boolean }[] = [];
  const details: unknown[] = [];
  const perTier: Record<string, { n: number; hit: number }> = {};
  let failures = 0;
  for (const f of ROUTING_FIXTURES) {
    const r = await classify(f.prompt, labels, { client, timeoutMs });
    perTier[f.label] ??= { n: 0, hit: 0 };
    perTier[f.label].n++;
    if (r.status !== 'ok') { failures++; details.push({ prompt: f.prompt, expected: f.label, status: r.status, reason: r.reason }); continue; }
    lat.push(r.latencyMs);
    const correct = r.label === f.label;
    if (correct) perTier[f.label].hit++;
    cal.push({ confidence: r.confidence, correct });
    details.push({ prompt: f.prompt, expected: f.label, predicted: r.label, confidence: r.confidence, margin: r.margin, correct });
  }
  const answered = cal.length;
  const metrics: Record<string, number> = { accuracy: answered ? cal.filter((c) => c.correct).length / answered : 0 };
  for (const [t, v] of Object.entries(perTier)) metrics[`acc_${t}`] = v.n ? v.hit / v.n : 0;
  return { feature: 'model_routing', cases: ROUTING_FIXTURES.length, failures, metrics, latency: latencyOf(lat), calibration: calibrationOf(cal), details };
}

async function runTools(client: RerankClient, timeoutMs: number): Promise<FeatureResult> {
  const candidates = Object.entries(TOOL_SERVERS).map(([id, tools]) => ({ id, text: `${id}: ${tools.join(', ')}` }));
  const lat: number[] = [];
  const cal: { confidence: number; correct: boolean }[] = [];
  const rrs: number[] = [];
  const rec3: number[] = [];
  const details: unknown[] = [];
  let failures = 0;
  for (const f of TOOL_FIXTURES) {
    const r = await rankCandidates(f.prompt, candidates, { client, timeoutMs });
    if (r.status !== 'ok') { failures++; details.push({ prompt: f.prompt, expected: f.expected, status: r.status, reason: r.reason }); continue; }
    lat.push(r.latencyMs);
    const rel = r.ranked.map((x) => f.expected.includes(x.id));
    rrs.push(reciprocalRank(rel));
    rec3.push(recallAtK(rel, 3, f.expected.length));
    cal.push({ confidence: r.ranked[0].score, correct: rel[0] });
    details.push({ prompt: f.prompt, expected: f.expected, top3: r.ranked.slice(0, 3), top1Correct: rel[0] });
  }
  const metrics = { top1_accuracy: cal.length ? cal.filter((c) => c.correct).length / cal.length : 0, recall_at_3: mean(rec3), mrr: mean(rrs) };
  return { feature: 'tool_ranking', cases: TOOL_FIXTURES.length, failures, metrics, latency: latencyOf(lat), calibration: calibrationOf(cal), details };
}

async function runMemory(client: RerankClient, timeoutMs: number): Promise<FeatureResult> {
  const minScore = getDecisionMemoryMinScore();
  const lat: number[] = [];
  const cal: { confidence: number; correct: boolean }[] = [];
  const ndcgs: number[] = [];
  const precs: number[] = [];
  const recs: number[] = [];
  const details: unknown[] = [];
  let failures = 0;
  for (const f of MEMORY_FIXTURES) {
    const r = await rankCandidates(f.query, f.pool.map((id) => ({ id, text: MEMORY_BANK[id] })), { client, timeoutMs });
    if (r.status !== 'ok') { failures++; details.push({ query: f.query, status: r.status, reason: r.reason }); continue; }
    lat.push(r.latencyMs);
    const rel = r.ranked.map((x) => f.relevant.includes(x.id));
    ndcgs.push(ndcg(rel.map((b) => (b ? 1 : 0)), 3));
    const pr = precisionRecallAtThreshold(r.ranked.map((x, i) => ({ score: x.score, relevant: rel[i] })), minScore);
    // precision is only meaningful when something was selected; count empty selection as 0
    precs.push(pr.precision);
    recs.push(pr.recall);
    cal.push({ confidence: r.ranked[0].score, correct: rel[0] });
    details.push({ query: f.query, note: f.note, relevant: f.relevant, ranked: r.ranked.map((x) => ({ id: x.id, score: Number(x.score.toFixed(4)) })), selected: pr.selected });
  }
  const metrics = { ndcg_at_3: mean(ndcgs), min_score: minScore, precision_at_min_score: mean(precs), recall_at_min_score: mean(recs), top1_relevant: cal.length ? cal.filter((c) => c.correct).length / cal.length : 0 };
  return { feature: 'memory_ranking', cases: MEMORY_FIXTURES.length, failures, metrics, latency: latencyOf(lat), calibration: calibrationOf(cal), details };
}

// ---- output ----
const f2 = (n: number) => n.toFixed(3);
const ms = (n: number) => `${n.toFixed(1)}ms`;

function printResult(r: FeatureResult): void {
  console.log(`\n== ${r.feature} (${r.cases} cases, ${r.failures} failed) ==`);
  for (const [k, v] of Object.entries(r.metrics)) console.log(`  ${k.padEnd(24)} ${f2(v)}`);
  console.log(`  latency p50/p95/max      ${ms(r.latency.p50)} / ${ms(r.latency.p95)} / ${ms(r.latency.max)} (n=${r.latency.n})`);
  console.log(`  ECE (5 bins, top score)  ${f2(r.calibration.ece)} (n=${r.calibration.n})`);
  console.log('  reliability:  bin          n   mean_conf  accuracy');
  for (const b of r.calibration.bins) {
    console.log(`                [${b.lo.toFixed(1)}, ${b.hi.toFixed(1)}${b.hi === 1 ? ']' : ')'}  ${String(b.n).padStart(4)}   ${b.n ? f2(b.meanConfidence) : '  -  '}      ${b.n ? f2(b.accuracy) : '  -  '}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client: RerankClient = args.fake
    ? new FakeRerankClient()
    : new HttpRerankClient({ baseUrl: args.baseUrl, model: args.model, timeoutMs: args.timeoutMs, scoreScale: args.scoreScale });

  console.log(`Decision bench: ${args.fake ? 'FAKE token-overlap scorer (pipeline smoke test only)' : `${args.baseUrl} model=${args.model} scale=${args.scoreScale ?? 'env/auto'}`}`);

  if (!args.fake) {
    const probe = await client.rerank('ping', ['pong'], { timeoutMs: args.timeoutMs });
    if (probe.status !== 'ok') {
      console.error(`\nDecision backend unreachable or unusable at ${args.baseUrl} (${probe.status}: ${probe.reason}).`);
      console.error(`Start a reranker server and see ${SETUP_DOC} for setup instructions.`);
      process.exit(1);
    }
  }

  const features = args.feature === 'all' ? ALL_FEATURES : [args.feature];
  const results: FeatureResult[] = [];
  for (const feature of features) {
    const r = feature === 'model_routing' ? await runRouting(client, args.timeoutMs)
      : feature === 'tool_ranking' ? await runTools(client, args.timeoutMs)
        : await runMemory(client, args.timeoutMs);
    results.push(r);
    printResult(r);
  }

  if (args.json) {
    fs.writeFileSync(args.json, JSON.stringify({ generatedAt: new Date().toISOString(), fake: args.fake, baseUrl: args.baseUrl, model: args.fake ? 'fake-token-overlap' : args.model, results }, null, 2));
    console.log(`\nWrote ${args.json}`);
  }
  if (results.some((r) => r.failures > 0)) {
    console.error('\nSome cases failed (timeouts/errors); see --json details.');
    process.exit(args.fake ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
