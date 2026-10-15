/**
 * Router calibration: run labelled prompts through the REAL routing classifier
 * (classify(prompt, TIER_LABELS)) and compare the tier/model it picks with the
 * tier/model you expect. Prints actionable calibration advice.
 *
 *   npx tsx scripts/decision_calibrate.ts [--agent claude-code] [--base-url http://127.0.0.1:8012]
 *     [--model qwen3-reranker-4b] [--score-scale auto|probability|logit] [--timeout-ms 30000]
 *     [--fake] [--json out.json] [--fixtures path.json] [--static-catalog]
 *
 * Without --base-url/--model/--score-scale the backend is whatever the router
 * uses (saved Router settings + AGENT_DECISION_* env). --fake uses a token-overlap
 * scorer (pipeline smoke test only). Exit 0 unless the backend is unreachable (1).
 */
import fs from 'node:fs';

import { getDecisionRoutingMinConfidence, type DecisionScoreScale } from '../src/config/env';
import { ROUTE_FALLBACKS_BY_AGENT } from '../src/services/agent_model_resolver';
import {
  TIERS,
  compareMarginToConfidence,
  confusionMatrix,
  describeMisroutes,
  directionOf,
  envLineForThreshold,
  overallAccuracy,
  perTierAccuracy,
  recommendThreshold,
  routeDirection,
  scoreScaleDiagnostic,
  thresholdSweep,
  type CalibrationRow,
  type Tier,
} from '../src/services/decision/calibration_analysis';
import { getDefaultRerankClient, HttpRerankClient, type RerankClient } from '../src/services/decision/decision_client';
import { classify } from '../src/services/decision/decision_engine';
import { TIER_LABELS } from '../src/services/decision/model_router';
import { CALIBRATION_FIXTURES, type CalibrationFixture } from './decision_calibrate/fixtures';
import { FakeRerankClient } from './decision_calibrate/fake';
import { knownAgents, loadExpectationCatalog, type ExpectationCatalog } from './decision_calibrate/models';
import { mean, percentile } from './decision_bench/metrics';

const SETUP_DOC = 'docs/ai/decision-engine-setup.md';
const TARGET_ACCURACY = 0.9;

interface Args {
  agent: string;
  baseUrl?: string;
  model?: string;
  scoreScale?: DecisionScoreScale;
  timeoutMs?: number;
  fake: boolean;
  json?: string;
  fixtures?: string;
  staticCatalog?: boolean;
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const a: Args = { agent: 'claude-code', fake: false };
  const val = (i: number, flag: string) => {
    if (i + 1 >= argv.length) fail(`Missing value for ${flag}`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--agent': a.agent = val(i++, '--agent'); break;
      case '--base-url': a.baseUrl = val(i++, '--base-url'); break;
      case '--model': a.model = val(i++, '--model'); break;
      case '--json': a.json = val(i++, '--json'); break;
      case '--fixtures': a.fixtures = val(i++, '--fixtures'); break;
      case '--timeout-ms': a.timeoutMs = Number(val(i++, '--timeout-ms')) || undefined; break;
      case '--score-scale': {
        const s = val(i++, '--score-scale');
        if (s !== 'auto' && s !== 'probability' && s !== 'logit') fail(`Unknown score scale ${s}`);
        a.scoreScale = s;
        break;
      }
      case '--fake': a.fake = true; break;
      case '--static-catalog': a.staticCatalog = true; break;
      default: fail(`Unknown argument ${argv[i]}`);
    }
  }
  if (!ROUTE_FALLBACKS_BY_AGENT[a.agent]) fail(`Unknown agent ${a.agent}. Known: ${knownAgents().join(', ')}`);
  return a;
}

function loadFixtures(path?: string): CalibrationFixture[] {
  if (!path) return CALIBRATION_FIXTURES;
  const raw = JSON.parse(fs.readFileSync(path, 'utf8')) as unknown;
  if (!Array.isArray(raw)) fail(`${path} must be a JSON array of {prompt, expectedTier, why}`);
  return raw.map((f, i) => {
    const o = f as Partial<CalibrationFixture>;
    if (typeof o.prompt !== 'string' || !TIERS.includes(o.expectedTier as Tier)) {
      fail(`${path}[${i}] needs a string prompt and expectedTier of cheap|standard|frontier`);
    }
    return { prompt: o.prompt, expectedTier: o.expectedTier as Tier, why: o.why ?? '' };
  });
}

interface Row extends CalibrationRow {
  why: string;
  expectedModel: string;
  pickedModel: string;
  latencyMs: number;
  applied: boolean;
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
const f2 = (n: number) => n.toFixed(2);
const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ');
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};
const pad = (s: string, n: number) => s.padEnd(n);
const heading = (s: string) => console.log(`\n== ${s} ==`);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const fixtures = loadFixtures(args.fixtures);
  const catalog: ExpectationCatalog = await loadExpectationCatalog({ forceStatic: args.staticCatalog });
  const expectedModelForTier = catalog.expectedModelForTier;
  const minConfidence = getDecisionRoutingMinConfidence();
  const overridden = args.baseUrl !== undefined || args.model !== undefined || args.scoreScale !== undefined;
  const client: RerankClient = args.fake
    ? new FakeRerankClient()
    : overridden
      ? new HttpRerankClient({ baseUrl: args.baseUrl, model: args.model, timeoutMs: args.timeoutMs, scoreScale: args.scoreScale })
      : getDefaultRerankClient();

  console.log(
    `Router calibration | agent=${args.agent} | backend=${
      args.fake ? 'FAKE token-overlap (pipeline smoke test only)' : overridden ? `${args.baseUrl ?? 'env'} model=${args.model ?? 'env'} scale=${args.scoreScale ?? 'env/auto'}` : 'router default (settings + env)'
    } | min-confidence=${minConfidence} | prompts=${fixtures.length}`,
  );

  console.log(`  ${catalog.label}${catalog.source === 'static' && !args.staticCatalog ? ' (engine catalog unavailable)' : ''}`);

  if (!args.fake) {
    const probe = await client.rerank('ping', ['pong'], args.timeoutMs ? { timeoutMs: args.timeoutMs } : undefined);
    if (probe.status !== 'ok') {
      console.error(`\nDecision backend unreachable or unusable (${probe.status}: ${probe.reason}).`);
      console.error(`Start a reranker server and see ${SETUP_DOC} for setup instructions.`);
      process.exit(1);
    }
  }

  const rows: Row[] = [];
  const failed: { prompt: string; status: string; reason: string }[] = [];
  for (const f of fixtures) {
    const r = await classify(f.prompt, TIER_LABELS, { client, ...(args.timeoutMs ? { timeoutMs: args.timeoutMs } : {}) });
    if (r.status !== 'ok') {
      failed.push({ prompt: f.prompt, status: r.status, reason: r.reason });
      continue;
    }
    rows.push({
      prompt: f.prompt,
      why: f.why,
      expectedTier: f.expectedTier,
      pickedTier: r.label,
      expectedModel: expectedModelForTier(args.agent, f.expectedTier),
      pickedModel: expectedModelForTier(args.agent, r.label),
      confidence: r.confidence,
      margin: r.margin,
      scores: r.scores,
      latencyMs: r.latencyMs,
      applied: r.confidence >= minConfidence,
    });
  }
  if (failed.length) console.log(`\n${failed.length} prompt(s) failed to classify and are excluded (see --json).`);
  if (rows.length === 0) {
    console.error('No prompt could be classified.');
    process.exit(1);
  }

  // ---- per-prompt table ----
  heading(`Per-prompt results (agent ${args.agent}; ✓ correct, ✗ wrong, abstain = below ${minConfidence})`);
  console.log(`${pad('#', 3)}${pad('', 2)}${pad('expected', 30)}${pad('picked', 30)}${pad('conf', 6)}${pad('marg', 6)}${pad('c/s/f scores', 18)}${pad('ms', 6)}prompt`);
  rows.forEach((r, i) => {
    const ok = r.pickedTier === r.expectedTier;
    console.log(
      `${pad(String(i + 1), 3)}${pad(ok ? '✓' : '✗', 2)}${pad(`${r.expectedTier}/${r.expectedModel}`, 30)}${pad(`${r.pickedTier}/${r.pickedModel}`, 30)}${pad(f2(r.confidence), 6)}${pad(f2(r.margin), 6)}${pad(`${f2(r.scores.cheap)}/${f2(r.scores.standard)}/${f2(r.scores.frontier)}`, 18)}${pad(r.latencyMs.toFixed(0), 6)}${clip(r.prompt, 52)}${r.applied ? '' : '  [abstain]'}`,
    );
  });

  // ---- summary ----
  const acc = overallAccuracy(rows);
  const appliedRows = rows.filter((r) => r.applied);
  const appliedAcc = appliedRows.length ? appliedRows.filter((r) => r.pickedTier === r.expectedTier).length / appliedRows.length : null;
  const lat = rows.map((r) => r.latencyMs);
  heading('Summary');
  console.log(`  overall accuracy         ${pct(acc)} (${rows.filter((r) => r.pickedTier === r.expectedTier).length}/${rows.length})`);
  console.log(`  at min-confidence ${minConfidence}: coverage ${pct(appliedRows.length / rows.length)} (${appliedRows.length}/${rows.length} applied, ${rows.length - appliedRows.length} abstain), applied-accuracy ${appliedAcc === null ? 'n/a' : pct(appliedAcc)}`);
  console.log(`  latency p50/p95/mean     ${percentile(lat, 50).toFixed(1)} / ${percentile(lat, 95).toFixed(1)} / ${mean(lat).toFixed(1)} ms`);
  const pta = perTierAccuracy(rows);
  for (const t of TIERS) console.log(`  ${pad(t, 9)} accuracy      ${pta[t].n ? pct(pta[t].accuracy) : 'n/a'} (${pta[t].hit}/${pta[t].n}) -> ${expectedModelForTier(args.agent, t)}`);

  // ---- confusion matrix ----
  heading('Confusion matrix (rows expected, columns picked)');
  const cm = confusionMatrix(rows);
  console.log(`  ${pad('expected \\ picked', 20)}${TIERS.map((t) => pad(t, 10)).join('')}`);
  for (const e of TIERS) console.log(`  ${pad(e, 20)}${TIERS.map((p) => pad(String(cm[e][p]), 10)).join('')}`);

  // ---- confidence sweep ----
  heading('Confidence threshold sweep (applied = confidence >= threshold)');
  const confSweep = thresholdSweep(rows, 'confidence');
  console.log(`  ${pad('thr', 6)}${pad('applied', 9)}${pad('coverage', 10)}accuracy(applied)`);
  for (const s of confSweep) console.log(`  ${pad(f2(s.threshold), 6)}${pad(String(s.applied), 9)}${pad(pct(s.coverage), 10)}${s.accuracy === null ? 'n/a' : pct(s.accuracy)}${s.threshold === Math.round(minConfidence * 20) / 20 ? '   <- current (rounded)' : ''}`);
  const rec = recommendThreshold(confSweep, TARGET_ACCURACY);
  if (rec.row) {
    console.log(`\n  RECOMMEND min-confidence ${f2(rec.threshold as number)}: ${pct(rec.row.accuracy as number)} applied-accuracy at ${pct(rec.row.coverage)} coverage.`);
    console.log(`  Set:  ${envLineForThreshold(rec.threshold as number)}   (env; there is no Router-settings field for this, it is env-only)`);
  } else {
    const b = rec.best;
    console.log(`\n  NO threshold reaches ${pct(TARGET_ACCURACY)} applied-accuracy (needs >= 3 applied prompts).${b ? ` Best: ${pct(b.accuracy as number)} at ${f2(b.threshold)} (coverage ${pct(b.coverage)}).` : ''}`);
    console.log('  Fix the tier descriptions (see diagnostics below) or the score scale before tuning the threshold.');
  }

  // ---- margin ----
  heading('Margin analysis (applied = top score minus runner-up >= threshold)');
  const cmp = compareMarginToConfidence(rows, TARGET_ACCURACY);
  console.log(`  ${pad('thr', 6)}${pad('applied', 9)}${pad('coverage', 10)}accuracy(applied)`);
  for (const s of thresholdSweep(rows, 'margin', [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6])) {
    console.log(`  ${pad(f2(s.threshold), 6)}${pad(String(s.applied), 9)}${pad(pct(s.coverage), 10)}${s.accuracy === null ? 'n/a' : pct(s.accuracy)}`);
  }
  console.log(`\n  ${cmp.text}`);
  if (cmp.marginBetter) console.log('  (The router currently gates on confidence only; a margin gate would need a change in model_router.ts.)');

  // ---- score scale ----
  heading('Score-scale diagnostic');
  const scale = scoreScaleDiagnostic(rows);
  console.log(`  mean per-prompt score spread ${scale.spread.toFixed(3)}; out-of-range scores: ${scale.outOfRange ? 'yes' : 'no'}`);
  console.log(`  ${scale.recommendation ?? 'Score scale looks healthy; no change needed.'}`);

  // ---- description diagnostics ----
  heading('Description diagnostics');
  console.log('  Current TIER_LABELS (edit in apps/api_server/src/services/decision/model_router.ts):');
  for (const l of TIER_LABELS) console.log(`    ${pad(l.id, 9)} ${l.description}`);
  const diag = describeMisroutes(rows, TIER_LABELS);
  if (diag.every((d) => d.overMatches.length === 0 && d.misses.length === 0)) console.log('\n  No misrouted prompts.');
  for (const d of diag) {
    if (!d.overMatches.length && !d.misses.length) continue;
    console.log(`\n  [${d.tier}]`);
    for (const m of d.misses) {
      console.log(`    missed: "${clip(m.prompt, 70)}" expected ${m.expectedTier}, ${m.pickedTier} won by ${f2(m.gap)}; shares with ${m.pickedTier} desc: ${m.overlapWithWinner.join(', ') || '-'}; with ${m.expectedTier} desc: ${m.overlapWithExpected.join(', ') || '-'}`);
    }
    for (const s of d.suggestions) console.log(`    suggestion: ${s}`);
  }

  // ---- cost / quality ----
  heading('Cost / quality direction');
  const dir = routeDirection(rows);
  console.log(`  correct ${dir.correct} | over-routed ${dir.over} (picked higher tier: extra cost) | under-routed ${dir.under} (picked lower tier: quality risk)`);
  const worst = rows.filter((r) => directionOf(r) === 'under');
  for (const r of worst) console.log(`    under: ${r.expectedTier}->${r.pickedTier} (${r.expectedModel} wanted, ${r.pickedModel} picked, conf ${f2(r.confidence)}) "${clip(r.prompt, 60)}"`);
  console.log(`  ${dir.recommendation ?? 'Errors are balanced or absent; no asymmetric policy needed.'}`);

  heading('Next step');
  console.log('  Adjust threshold/descriptions -> rerun this script -> when applied-accuracy holds, set the model-routing feature to On.');

  if (args.json) {
    fs.writeFileSync(
      args.json,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          agent: args.agent,
          fake: args.fake,
          minConfidence,
          tierLabels: TIER_LABELS,
          tierModels: Object.fromEntries(TIERS.map((t) => [t, expectedModelForTier(args.agent, t)])),
          catalog: { source: catalog.source, models: catalog.models.length },
          routeTiers: catalog.routeTiers(args.agent),
          summary: { accuracy: acc, appliedAccuracy: appliedAcc, coverage: appliedRows.length / rows.length, perTier: pta, confusion: cm, direction: dir },
          confidenceSweep: confSweep,
          recommendation: { threshold: rec.threshold, envLine: rec.threshold === null ? null : envLineForThreshold(rec.threshold) },
          marginComparison: cmp,
          scale,
          diagnostics: diag,
          results: rows,
          failed,
        },
        null,
        2,
      ),
    );
    console.log(`\nWrote ${args.json}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
