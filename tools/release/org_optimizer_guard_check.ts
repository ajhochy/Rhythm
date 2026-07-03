/**
 * org_optimizer_guard_check.ts — #831 (org-optimizer-15) safety-model guard.
 *
 * Node/TypeScript harness invoked by tools/release/smoke_org_optimizer.sh via
 * `tsx` (already a devDependency of apps/api_server, matching its documented
 * `"dev": "tsx"` script). Run directly against apps/api_server's TypeScript
 * SOURCE (not dist/, not the opencode binary) using an in-memory
 * better-sqlite3 database — the same `runMigrations`/`setDb` pattern used by
 * apps/api_server/src/__tests__/issue_831_contract.test.ts.
 *
 * DELIBERATE DEVIATION from the tools/release/smoke_mcp_alignment.sh /
 * smoke_skill_alignment.sh precedent: those two smokes exercise the OPENCODE
 * ENGINE binary (a compiled Go-adjacent Bun/JS binary whose behavior can only
 * be verified by actually running it) because their invariant lives inside
 * that binary's HTTP surface. Issue #831's safety model — classifyProposalRisk,
 * applyProposal, requiresSecurityNote/hasSecurityNote — lives entirely in
 * apps/api_server's TypeScript service layer, with zero dependency on the
 * opencode engine. Spinning up a full signed opencode binary to prove a
 * SQLite state machine transition is unnecessary process weight and (per
 * project memory: "opencode fork rebuild + cp/AMFI resign gotcha") requires a
 * full release build unavailable in a plain CI/dev sandbox. This harness
 * proves the exact same invariants directly against the real service code,
 * runnable in any environment with Node + the api_server's node_modules —
 * no signed binary, no macOS entitlements, no notarization required.
 *
 * Exits 0 on success, non-zero (via process.exit(1) or an uncaught throw) on
 * ANY violation. Each of the four sub-checks below prints a `[PASS]`/`[FAIL]`
 * line; a single failure fails the whole run.
 */

import Database from 'better-sqlite3';
import { runMigrations } from '../../apps/api_server/src/database/migrations';
import { setDb, getDb } from '../../apps/api_server/src/database/db';
import { AgentOrgProposalsRepository } from '../../apps/api_server/src/repositories/agent_org_proposals_repository';
import { AgentConfigsRepository } from '../../apps/api_server/src/repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../../apps/api_server/src/repositories/agent_sessions_repository';
import { classifyProposalRisk } from '../../apps/api_server/src/services/org_risk_classifier';
import { applyProposal } from '../../apps/api_server/src/services/org_proposal_apply';
import { measureProposal } from '../../apps/api_server/src/services/org_proposal_measure';
import {
  requiresSecurityNote,
  hasSecurityNote,
} from '../../apps/api_server/src/services/org_proposal_apply_service';
import { detectTightenGaps } from '../../apps/api_server/src/services/org_audit_service';
import { generateScopeHygieneProposals } from '../../apps/api_server/src/services/generators/scope_hygiene_generator';
import type { OrgAuditSnapshot } from '../../apps/api_server/src/services/org_audit_service';

let failures = 0;

function ok(label: string) {
  console.log(`[PASS] ${label}`);
}

function bad(label: string, detail: string) {
  failures += 1;
  console.error(`[FAIL] ${label} — ${detail}`);
}

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
}

/**
 * (a) AUTO-PATH REVERT — apply a low-risk prune-scope proposal, force the
 * functional guard to fail (the pruned tool turns out to be exercised), and
 * confirm the revert restores both the DB row (status='reverted', the
 * original before_snapshot_json retained) and the live agent_configs value.
 */
async function checkAutoPathRevert(): Promise<void> {
  freshDb();
  const configsRepo = new AgentConfigsRepository();
  const config = configsRepo.insert({
    label: 'Secretary',
    icon: 'mail',
    allowedMcpsJson: JSON.stringify(['nfl_mcp', 'rhythm']),
  });

  const proposalsRepo = new AgentOrgProposalsRepository();
  const proposal = await proposalsRepo.createAsync({
    kind: 'prune-scope',
    risk: 'low',
    title: 'Prune nfl_mcp (guard-check forced regression)',
    targetRef: `agent_config:${config.id}`,
    changeJson: JSON.stringify({
      agentConfigId: config.id,
      field: 'allowedMcpsJson',
      remove: ['nfl_mcp'],
    }),
    dedupKey: 'guard-check:prune-scope:forced-regression',
  });

  const applied = await applyProposal(proposal);
  if (applied.status !== 'applied-ok') {
    bad('auto-path-revert', `applyProposal expected 'applied-ok', got '${applied.status}'`);
    return;
  }
  const measuring = await proposalsRepo.findByIdAsync(proposal.id);
  if (measuring?.status !== 'measuring' || !measuring.beforeSnapshotJson) {
    bad('auto-path-revert', 'proposal did not reach measuring with a snapshot after apply');
    return;
  }
  const originalSnapshot = measuring.beforeSnapshotJson;

  // Force the regression: the pruned tool WAS actually exercised.
  const outcome = await measureProposal(measuring, {
    exercisedTools: async () => new Set(['nfl_mcp']),
  });
  if (outcome !== 'reverted') {
    bad('auto-path-revert', `measureProposal expected 'reverted', got '${outcome}'`);
    return;
  }

  const final = await proposalsRepo.findByIdAsync(proposal.id);
  if (final?.status !== 'reverted') {
    bad('auto-path-revert', `final row status expected 'reverted', got '${final?.status}'`);
    return;
  }
  if (final.beforeSnapshotJson !== originalSnapshot) {
    bad('auto-path-revert', 'before_snapshot_json was not preserved through the revert transition');
    return;
  }
  const restoredConfig = configsRepo.getById(config.id);
  const restoredList = JSON.parse(restoredConfig?.allowedMcpsJson ?? '[]');
  if (JSON.stringify(restoredList) !== JSON.stringify(['nfl_mcp', 'rhythm'])) {
    bad('auto-path-revert', `live agent_configs.allowedMcpsJson not restored: got ${restoredConfig?.allowedMcpsJson}`);
    return;
  }

  ok('auto-path-revert: status=reverted, before_snapshot_json preserved, live config restored');
}

const NEVER_AUTO_APPLY_KINDS = [
  'create-agent',
  'grant-delegation',
  'expand-delegation',
  'broaden-scope',
  'webhook-wiring',
  'external-adoption',
];

/**
 * (b) GATE INVARIANTS — every hard-gated kind classifies 'high' and is
 * refused by applyProposal even when the row is mislabeled risk='low'.
 *
 * `classifier` is injectable so the fail-injection check (d) can pass a
 * deliberately-broken stand-in and prove this exact function call would
 * catch the regression.
 */
async function checkGateInvariants(
  classifier: typeof classifyProposalRisk = classifyProposalRisk,
): Promise<{ allPassed: boolean; violations: string[] }> {
  freshDb();
  const violations: string[] = [];

  for (const kind of NEVER_AUTO_APPLY_KINDS) {
    const risk = classifier({ kind });
    if (risk !== 'high') {
      violations.push(`classifyProposalRisk('${kind}') returned '${risk}', expected 'high'`);
      continue;
    }

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind,
      risk: 'low', // deliberately mislabeled
      title: `Mislabeled ${kind} proposal (guard-check)`,
      dedupKey: `guard-check:gate-invariant:${kind}`,
    });
    const result = await applyProposal(proposal);
    if (result.status !== 'refused-high-risk') {
      violations.push(
        `applyProposal('${kind}', mislabeled risk=low) returned '${result.status}', expected 'refused-high-risk'`,
      );
      continue;
    }
    const unchanged = await proposalsRepo.findByIdAsync(proposal.id);
    if (unchanged?.status !== 'proposed') {
      violations.push(
        `'${kind}' row status changed to '${unchanged?.status}' despite refusal — must stay 'proposed'`,
      );
    }
  }

  return { allPassed: violations.length === 0, violations };
}

async function runGateInvariantsCheck(): Promise<void> {
  const { allPassed, violations } = await checkGateInvariants();
  if (!allPassed) {
    for (const v of violations) bad('gate-invariants', v);
    return;
  }
  ok(
    `gate-invariants: all ${NEVER_AUTO_APPLY_KINDS.length} high-risk kinds (${NEVER_AUTO_APPLY_KINDS.join(', ')}) classify 'high' and are refused by applyProposal`,
  );
}

/**
 * (c) NOTE-REQUIRED GATE — external-adoption and webhook-wiring must require
 * a non-empty provenance/security note before approval; a missing/blank/
 * empty-object provenance_json must not satisfy the gate.
 */
function checkNoteRequiredGate(): void {
  const kinds = ['external-adoption', 'webhook-wiring'];
  for (const kind of kinds) {
    if (!requiresSecurityNote({ kind })) {
      bad('note-required-gate', `requiresSecurityNote('${kind}') is false, expected true`);
      continue;
    }
    const emptyCases: Array<string | null> = [null, '', '   ', '{}'];
    for (const provenanceJson of emptyCases) {
      if (hasSecurityNote({ provenanceJson })) {
        bad(
          'note-required-gate',
          `hasSecurityNote('${kind}', provenanceJson=${JSON.stringify(provenanceJson)}) is true, expected false`,
        );
        return;
      }
    }
    const populated = JSON.stringify({ source: 'github.com/example/example', license: 'MIT' });
    if (!hasSecurityNote({ provenanceJson: populated })) {
      bad('note-required-gate', `hasSecurityNote('${kind}') is false for a populated provenance_json`);
      return;
    }
  }
  ok('note-required-gate: external-adoption and webhook-wiring both require a non-empty provenance_json to approve');
}

/**
 * (d) FAIL-INJECTION — the guard-regression detection case the issue
 * explicitly mandates. Re-run the SAME gate-invariant check (b) but with a
 * deliberately-broken classifier that misclassifies 'grant-delegation' as
 * low-risk (simulating a hypothetical future regression in
 * org_risk_classifier.ts's LOW_RISK_KINDS set). This sub-check PASSES only
 * if the broken classifier IS detected as broken — i.e. checkGateInvariants
 * reports allPassed=false when run against it. This proves the smoke script
 * itself is load-bearing: it is not merely asserting today's code is correct,
 * it demonstrably CATCHES the exact class of regression it exists to guard
 * against.
 */
async function checkFailInjectionDetectsRegression(): Promise<void> {
  const regressedClassifier: typeof classifyProposalRisk = (input) => {
    const buggyLowRiskKinds = new Set([
      'refine-skill',
      'consolidate-skill',
      'tighten-scope',
      'prune-scope',
      'refine-recipe',
      'grant-delegation', // <-- the injected regression: a high-risk kind leaked into "low"
    ]);
    const kind = (input.kind ?? '').trim();
    return buggyLowRiskKinds.has(kind) ? 'low' : 'high';
  };

  const { allPassed, violations } = await checkGateInvariants(regressedClassifier);

  if (allPassed) {
    // The regressed classifier should NOT pass — if it does, the guard check
    // itself has a blind spot and cannot be trusted to catch a real
    // regression. This is a FAILURE of the fail-injection proof.
    bad(
      'fail-injection',
      'the broken classifier (grant-delegation misclassified low-risk) was NOT detected — the gate-invariant check has a blind spot',
    );
    return;
  }

  const caughtIt = violations.some((v) => v.includes("classifyProposalRisk('grant-delegation')"));
  if (!caughtIt) {
    bad(
      'fail-injection',
      `regression was detected but not for the expected reason: ${violations.join('; ')}`,
    );
    return;
  }

  ok(
    `fail-injection: the guard-invariant check correctly detected the injected regression (${violations[0]})`,
  );

  // Now confirm the REAL (non-monkey-patched) classifier passes cleanly —
  // proving the fail-injection harness itself isn't just permanently broken.
  const realRun = await checkGateInvariants();
  if (!realRun.allPassed) {
    bad(
      'fail-injection',
      `the real (unpatched) classifier failed its own gate-invariant check: ${realRun.violations.join('; ')}`,
    );
    return;
  }
  ok('fail-injection: the real (unpatched) classifier passes the same check cleanly (no false positives)');
}

/**
 * (e) #857 THIN-HISTORY GUARD — a profile observed for less than the
 * data-sufficiency floor (recent created_at, few/no recorded sessions) must
 * NEVER produce a tighten-scope gap, even when it allowlists a live, matched,
 * never-invoked MCP name — and therefore NEVER produce (let alone
 * auto-apply) a tighten-scope proposal for it. This is the exact live-run
 * failure #857 exists to close: with ~1h of uptime and 3 denied_tool_events,
 * the pre-fix generator auto-applied 16 tighten/prune proposals that
 * stripped tools agents actively use. A second profile with sufficient
 * history and a genuinely-unused tool must still produce a gap — proving the
 * guard suppresses only the thin-data case, not the feature entirely.
 */
async function checkThinHistoryNoAutoAppliedTighten(): Promise<void> {
  freshDb();
  const configsRepo = new AgentConfigsRepository();
  const sessionsRepo = new AgentSessionsRepository();

  // Thin profile: freshly created, a single recorded session.
  const thinProfile = configsRepo.insert({
    label: 'Thin History Secretary',
    icon: 'mail',
    allowedMcpsJson: JSON.stringify(['rhythm', 'nfl-mcp']),
  });
  sessionsRepo.insert({
    agentKind: 'claude-code',
    taskId: null,
    cwd: '/tmp',
    name: 'session-1',
    mcpRole: thinProfile.id,
  });

  // Well-observed profile: backdated past the observation window, with
  // enough recorded sessions to clear the activity floor.
  const observedProfile = configsRepo.insert({
    label: 'Well Observed Secretary',
    icon: 'mail',
    allowedMcpsJson: JSON.stringify(['rhythm', 'nfl-mcp']),
  });
  getDb()
    .prepare(`UPDATE agent_configs SET created_at = ? WHERE id = ?`)
    .run(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), observedProfile.id);
  for (let i = 0; i < 10; i++) {
    sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp',
      name: `observed-session-${i}`,
      mcpRole: observedProfile.id,
    });
  }

  const liveMcpNames = new Set(['rhythm', 'nfl-mcp']);
  const deniedPairs = new Set<string>();
  const sessionCountByProfile = new Map<string, number>([
    [thinProfile.id, 1],
    [observedProfile.id, 10],
  ]);
  const observationDaysByProfile = new Map<string, number>([
    [thinProfile.id, 0],
    [observedProfile.id, 30],
  ]);

  const gaps = detectTightenGaps(
    [
      {
        id: thinProfile.id,
        label: thinProfile.label,
        isManager: false,
        enabled: true,
        allowedMcps: ['rhythm', 'nfl-mcp'],
        allowedSkills: [],
        allowedDelegates: [],
      },
      {
        id: observedProfile.id,
        label: observedProfile.label,
        isManager: false,
        enabled: true,
        allowedMcps: ['rhythm', 'nfl-mcp'],
        allowedSkills: [],
        allowedDelegates: [],
      },
    ],
    liveMcpNames,
    deniedPairs,
    sessionCountByProfile,
    observationDaysByProfile,
  );

  const thinGaps = gaps.filter((g) => g.evidence.includes(thinProfile.id));
  if (thinGaps.length > 0) {
    bad(
      'thin-history-guard',
      `thin/unobserved profile '${thinProfile.id}' produced ${thinGaps.length} tighten-scope gap(s) — expected 0`,
    );
    return;
  }

  const observedGaps = gaps.filter((g) => g.evidence.includes(observedProfile.id));
  if (observedGaps.length === 0) {
    bad(
      'thin-history-guard',
      `well-observed profile '${observedProfile.id}' produced NO tighten-scope gap — the guard is suppressing the feature entirely, not just thin data`,
    );
    return;
  }

  // Now prove the gap-level guard actually protects the auto-apply lane:
  // feed a hand-built snapshot containing a tighten-scope gap for the THIN
  // profile as if it had (incorrectly) been generated, and confirm that even
  // if such a gap existed, this is not how the real pipeline behaves —
  // instead, assert the generator only ever receives the observed-profile
  // gap from a real buildOrgAuditSnapshot-shaped call, i.e. zero
  // tighten-scope proposals are ever created for the thin profile end-to-end.
  const proposalsRepo = new AgentOrgProposalsRepository();
  const snapshot: OrgAuditSnapshot = {
    auditRunId: 'guard-check-857',
    generatedAt: new Date().toISOString(),
    engineAvailable: true,
    profiles: [],
    skills: [],
    skillOverlapCandidates: [],
    recipes: [],
    delegationEdges: [],
    webhookEndpoints: [],
    deniedToolAggregates: [],
    drift: [],
    gaps,
  };
  await generateScopeHygieneProposals(snapshot, { proposalsRepo });

  const allProposed = await proposalsRepo.listByStatusAsync('proposed');
  const allApplied = await proposalsRepo.listByStatusAsync('applied');
  const allMeasuring = await proposalsRepo.listByStatusAsync('measuring');
  const everyRow = [...allProposed, ...allApplied, ...allMeasuring];
  const thinProposals = everyRow.filter(
    (p) => p.kind === 'tighten-scope' && (p.targetRef ?? '').includes(thinProfile.id),
  );
  if (thinProposals.length > 0) {
    bad(
      'thin-history-guard',
      `generateScopeHygieneProposals produced ${thinProposals.length} tighten-scope proposal(s) for the thin/unobserved profile — expected 0 (auto-apply would have stripped a tool with no proof it is unused)`,
    );
    return;
  }

  const observedProposals = everyRow.filter(
    (p) => p.kind === 'tighten-scope' && (p.targetRef ?? '').includes(observedProfile.id),
  );
  if (observedProposals.length === 0) {
    bad(
      'thin-history-guard',
      'generateScopeHygieneProposals produced NO tighten-scope proposal for the well-observed profile — the guard is over-suppressing',
    );
    return;
  }

  ok(
    'thin-history-guard: thin/unobserved profile produces zero tighten-scope gaps/proposals; a well-observed profile with a genuinely unused tool still produces one',
  );
}

async function main() {
  console.log('=== org-optimizer safety guard check (#831 + #857) ===');
  await checkAutoPathRevert();
  await runGateInvariantsCheck();
  checkNoteRequiredGate();
  await checkFailInjectionDetectsRegression();
  await checkThinHistoryNoAutoAppliedTighten();

  console.log('===============================================');
  if (failures > 0) {
    console.error(`${failures} violation(s) detected — FAIL`);
    process.exit(1);
  }
  console.log('All org-optimizer safety guard checks passed — OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('[FAIL] uncaught error in guard check harness:', err);
  process.exit(1);
});
