/// CONTRACT TEST for C6-3 (causal-runtime-v2 phase C6, GitHub issue #1448).
///
/// See docs/ai/contracts/issue-c6.json (criterion c6-3). Deployment status
/// (`OrgProposal.status`) and causal outcome (`OrgProposal.outcomeStatus`)
/// are already surfaced separately by the existing `_AppliedTab`/
/// `_AppliedCard` (W6-c8) — these tests prove the ADDITIVE experiment
/// summary fields this phase adds on top: collecting progress,
/// eligible/missing counts, treatment integrity, guardrail status,
/// experiment terminal reason, and — because `staleBeforeApplyConflict` is
/// only ever true for a proposal that has NOT been applied yet — the
/// "Waiting for you" tab's `_ProposalCard`, not `_AppliedCard`.
///
/// Per repo convention (org_proposals_view_test.dart), every test pumps the
/// REAL, MOUNTED `OrgProposalsView`; only `OrgProposalsDataSource` is faked.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/features/agent_optimizer/controllers/org_proposals_controller.dart';
import 'package:rhythm_desktop/features/agent_optimizer/data/org_proposals_data_source.dart';
import 'package:rhythm_desktop/features/agent_optimizer/models/org_proposal.dart';
import 'package:rhythm_desktop/features/agent_optimizer/repositories/org_proposals_repository.dart';
import 'package:rhythm_desktop/features/agent_optimizer/views/org_proposals_view.dart';

// ---------------------------------------------------------------------------
// Fake data source — the ONLY faked boundary.
// ---------------------------------------------------------------------------

class _FakeDataSource extends OrgProposalsDataSource {
  _FakeDataSource(this._byStatus);

  final Map<String, List<OrgProposal>> _byStatus;

  @override
  Future<List<OrgProposal>> listProposed({String status = 'proposed'}) async {
    return _byStatus[status] ?? const [];
  }
}

final _kEpoch = DateTime.fromMillisecondsSinceEpoch(0).toIso8601String();

OrgProposal _proposal({
  required String id,
  required String status,
  String outcomeStatus = 'unproven',
  ExperimentSummary? experimentSummary,
  String kind = 'refine-config',
  String? changeJson,
}) {
  return OrgProposal(
    id: id,
    kind: kind,
    risk: 'low',
    external: 0,
    status: status,
    outcomeStatus: outcomeStatus,
    title: 'Refine the system prompt',
    changeJson: changeJson,
    experimentSummary: experimentSummary,
    createdAt: _kEpoch,
    updatedAt: _kEpoch,
  );
}

Future<void> _pumpApp(
  WidgetTester tester,
  OrgProposalsController controller,
) async {
  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<OrgProposalsController>.value(
          value: controller,
        ),
      ],
      child: const MaterialApp(home: OrgProposalsView()),
    ),
  );
  await tester.pump();
}

Future<void> _openAppliedTab(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('org-proposals-tab-applied')));
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group(
    'C6-3 desktop UI surfaces deployment status, causal outcome, collecting progress, missing counts, treatment integrity, guardrail status, experiment terminal reason, baseline/candidate hashes, and stale-before-apply conflicts',
    () {
      testWidgets(
        'issue-c6-c3a: an applied row still shows deployment status and causal outcome as two separate facts',
        (tester) async {
          final proposal = _proposal(
            id: 'p1',
            status: 'active',
            outcomeStatus: 'verified',
          );
          final controller = OrgProposalsController(
            OrgProposalsRepository(
              _FakeDataSource({
                'active': [proposal],
                'applied': [],
                'measuring': [],
              }),
            ),
          );

          await _pumpApp(tester, controller);
          await _openAppliedTab(tester);

          expect(find.text('In use now'), findsOneWidget);
          expect(find.text('Checked — it helped'), findsOneWidget);
          controller.dispose();
        },
      );

      testWidgets(
        'issue-c6-c3b: shows collecting progress, eligible/missing counts, reliability and safety-check status while an experiment collects',
        (tester) async {
          final proposal = _proposal(
            id: 'p2',
            status: 'measuring',
            experimentSummary: const ExperimentSummary(
              collectingProgress: 'collecting',
              eligibleCount: 3,
              missingCount: 1,
              treatmentIntegrity: 'ok',
              guardrailStatus: 'ok',
              staleBeforeApplyConflict: false,
            ),
          );
          final controller = OrgProposalsController(
            OrgProposalsRepository(
              _FakeDataSource({
                'active': [],
                'applied': [],
                'measuring': [proposal],
              }),
            ),
          );

          await _pumpApp(tester, controller);
          await _openAppliedTab(tester);

          expect(find.text('Still gathering results'), findsOneWidget);
          expect(find.text('3 ok, 1 missing'), findsOneWidget);
          expect(find.text('Working normally'), findsOneWidget);
          expect(find.text('No safety limits triggered'), findsOneWidget);
          controller.dispose();
        },
      );

      testWidgets(
        'issue-c6-c3c: shows the experiment terminal reason once a decision is recorded, and hides experiment facts entirely when no experiment was ever declared',
        (tester) async {
          final decided = _proposal(
            id: 'p3',
            status: 'active',
            outcomeStatus: 'regressed',
            experimentSummary: const ExperimentSummary(
              collectingProgress: 'decided',
              eligibleCount: 8,
              missingCount: 0,
              treatmentIntegrity: 'ok',
              guardrailStatus: 'ok',
              terminalReason: 'candidate underperformed the baseline',
              staleBeforeApplyConflict: false,
            ),
          );
          final noExperiment = _proposal(
            id: 'p4',
            status: 'active',
            kind: 'create-agent',
            experimentSummary: const ExperimentSummary(
              collectingProgress: 'no_experiment',
              eligibleCount: 0,
              missingCount: 0,
              treatmentIntegrity: 'unknown',
              guardrailStatus: 'unknown',
              staleBeforeApplyConflict: false,
            ),
          );
          final controller = OrgProposalsController(
            OrgProposalsRepository(
              _FakeDataSource({
                'active': [decided, noExperiment],
                'applied': [],
                'measuring': [],
              }),
            ),
          );

          await _pumpApp(tester, controller);
          await _openAppliedTab(tester);

          expect(find.text('Finished testing'), findsOneWidget);
          expect(
            find.text('candidate underperformed the baseline'),
            findsOneWidget,
          );
          // The no-experiment row shows only the two base facts — none of
          // the experiment-only rows leak onto a proposal that never ran one.
          expect(find.text('Testing'), findsOneWidget);
          expect(find.text('Reliability'), findsOneWidget);
        },
      );

      testWidgets(
        'issue-c6-c3d: renders only safe short tested hashes and keeps stale conflicts on the pre-apply card',
        (tester) async {
          const baselineHash =
              'ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
          const candidateHash =
              'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
          const malformedHash = 'abc123-not-a-sha';
          const sentinelContent =
              'SENTINEL_PROMPT_CONFIG_BYTES_MUST_NOT_RENDER';
          final applied = _proposal(
            id: 'p6',
            status: 'active',
            changeJson: '{"system_prompt":"$sentinelContent"}',
            experimentSummary: const ExperimentSummary(
              collectingProgress: 'decided',
              eligibleCount: 5,
              missingCount: 0,
              treatmentIntegrity: 'ok',
              guardrailStatus: 'ok',
              testedBaselineHash: baselineHash,
              testedCandidateHash: candidateHash,
              staleBeforeApplyConflict: false,
            ),
          );
          final malformed = _proposal(
            id: 'p7',
            status: 'active',
            experimentSummary: const ExperimentSummary(
              collectingProgress: 'decided',
              eligibleCount: 1,
              missingCount: 0,
              treatmentIntegrity: 'ok',
              guardrailStatus: 'ok',
              testedBaselineHash: malformedHash,
              staleBeforeApplyConflict: false,
            ),
          );
          // staleBeforeApplyConflict is only ever true while a proposal is
          // still proposed/approved/failed (server:
          // proposal_experiment_summary_service.ts) — so it belongs on the
          // "Waiting for you" tab's _ProposalCard, not _AppliedCard.
          final stale = _proposal(
            id: 'p5',
            status: 'proposed',
            changeJson:
                '{"configPatch":{"agentConfigId":"a1","field":"system_prompt","value":"NEW"}}',
            experimentSummary: const ExperimentSummary(
              collectingProgress: 'decided',
              eligibleCount: 5,
              missingCount: 0,
              treatmentIntegrity: 'ok',
              guardrailStatus: 'ok',
              terminalReason: 'candidate won',
              testedBaselineHash:
                  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              testedCandidateHash:
                  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              staleBeforeApplyConflict: true,
            ),
          );
          final controller = OrgProposalsController(
            OrgProposalsRepository(
              _FakeDataSource({
                'proposed': [stale],
                'active': [applied, malformed],
                'applied': [],
                'measuring': [],
              }),
            ),
          );
          await controller.refresh();

          await _pumpApp(tester, controller);
          // Default tab is "Waiting for you" — no tap needed.

          expect(
              find.byKey(const ValueKey('stale-conflict-p5')), findsOneWidget);
          expect(
            find.textContaining(
              'tested, but the settings changed again since then',
            ),
            findsOneWidget,
          );
          // Never the raw content bytes — only a safe fingerprint is carried
          // on the model, and the banner text never renders it verbatim.
          expect(
            find.text(
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            ),
            findsNothing,
          );

          await _openAppliedTab(tester);
          expect(find.byKey(const ValueKey('stale-conflict-p5')), findsNothing);
          expect(find.text('Tested baseline'), findsOneWidget);
          expect(find.text('sha256:abcdef012345'), findsOneWidget);
          expect(find.text('Tested candidate'), findsOneWidget);
          expect(find.text('sha256:bbbbbbbbbbbb'), findsOneWidget);
          expect(find.textContaining(baselineHash), findsNothing);
          expect(find.textContaining(candidateHash), findsNothing);
          expect(find.textContaining(malformedHash), findsNothing);
          expect(find.textContaining(sentinelContent), findsNothing);
          controller.dispose();
        },
      );
    },
  );
}
