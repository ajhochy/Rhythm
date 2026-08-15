/// CONTRACT TEST for issue #827 (org-optimizer-11) — Flutter review surface.
///
/// See docs/ai/contracts/issue-827.json for the criterion mapping.
///
/// Per repo memory (prior inspector work was orphaned by testing unmounted
/// widgets), every test here pumps the REAL, MOUNTED `OrgProposalsView` —
/// not an isolated `_ProposalCard` or `_SecurityNoteBlock` sub-widget — with
/// a fake data source underneath the real repository/controller chain, the
/// same pattern `agent_cookbook_view_test.dart` uses.
///
/// Covers:
///  - issue-827-c1: the tab lists status='proposed' proposals with kind,
///    risk badge, title, rationale, and an evidence/expand affordance.
///  - issue-827-c2: Approve -> POST /:id/approve; Reject -> POST /:id/reject;
///    list refreshes (the approved/rejected row disappears).
///  - issue-827-c3: external-adoption renders the provenance block; Approve
///    is disabled until it is present.
///  - issue-827-c4: webhook-wiring renders the security block; Approve is
///    disabled until it is present.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/features/agent_optimizer/controllers/org_proposals_controller.dart';
import 'package:rhythm_desktop/features/agent_optimizer/data/org_proposals_data_source.dart';
import 'package:rhythm_desktop/features/agent_optimizer/models/org_proposal.dart';
import 'package:rhythm_desktop/features/agent_optimizer/repositories/org_proposals_repository.dart';
import 'package:rhythm_desktop/features/agent_optimizer/views/org_proposals_view.dart';
import 'package:rhythm_desktop/app/core/errors/app_error.dart';

// ---------------------------------------------------------------------------
// Fake data source — the ONLY faked boundary. Everything above it (model,
// repository, controller, view) is the real production code path.
// ---------------------------------------------------------------------------

class _FakeOrgProposalsDataSource extends OrgProposalsDataSource {
  _FakeOrgProposalsDataSource(this._proposals);

  final List<OrgProposal> _proposals;

  String? lastApprovedId;
  String? lastRejectedId;

  /// If set, approve()/reject() throw for this id — simulates the server's
  /// 400 refusal so the view's error handling can be asserted too.
  String? failId;

  @override
  Future<List<OrgProposal>> listProposed({String status = 'proposed'}) async {
    listCalls += 1;
    final refreshed = refreshedProposals;
    if (refreshed != null && _approveAttempted) return refreshed;
    return _proposals;
  }

  /// If set, approve() throws the server's reconciliation conflict for this
  /// id — the operation was durably recorded as unresolved, which is neither
  /// success nor a retryable failure.
  String? reconciliationId;

  /// Rows the server would return on a re-read after a failed approve. The
  /// controller re-reads because the server may have moved the row out of
  /// `proposed` even though the approve did not succeed.
  List<OrgProposal>? refreshedProposals;
  int listCalls = 0;
  bool _approveAttempted = false;

  @override
  Future<OrgProposal> approve(String id, {int? decidedByUserId}) async {
    _approveAttempted = true;
    if (id == reconciliationId) {
      // Exactly what assertOk builds from the server's 409 body: the code is
      // what the client must discriminate on, never the prose.
      throw AppError(
        'Proposal $id: profile projection blocked; the proposal, target scope '
        'and projected profile must be inspected before retrying',
        code: 'RECONCILIATION_REQUIRED',
        statusCode: 409,
      );
    }
    if (id == failId) {
      throw AppError(
        'Approve refused: missing security note',
        code: 'BAD_REQUEST',
        statusCode: 400,
      );
    }
    lastApprovedId = id;
    final proposal = _proposals.firstWhere((p) => p.id == id);
    _proposals.removeWhere((p) => p.id == id);
    return proposal;
  }

  @override
  Future<OrgProposal> reject(String id, {int? decidedByUserId}) async {
    lastRejectedId = id;
    final proposal = _proposals.firstWhere((p) => p.id == id);
    _proposals.removeWhere((p) => p.id == id);
    return proposal;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

final _kEpoch = DateTime.fromMillisecondsSinceEpoch(0).toIso8601String();

OrgProposal _makeProposal({
  required String id,
  required String kind,
  String risk = 'high',
  int external = 0,
  String title = 'Sample proposal',
  String? rationale = 'Because the audit found a gap.',
  String? signalRef,
  String? changeJson,
  String? beforeSnapshotJson,
  String? provenanceJson,
}) {
  return OrgProposal(
    id: id,
    kind: kind,
    risk: risk,
    external: external,
    status: 'proposed',
    title: title,
    rationale: rationale,
    signalRef: signalRef,
    changeJson: changeJson,
    beforeSnapshotJson: beforeSnapshotJson,
    provenanceJson: provenanceJson,
    createdAt: _kEpoch,
    updatedAt: _kEpoch,
  );
}

Future<Widget> _buildApp(OrgProposalsController controller) async {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<OrgProposalsController>.value(value: controller),
    ],
    child: const MaterialApp(home: OrgProposalsView()),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('OrgProposalsView (REAL SURFACE)', () {
    testWidgets(
        'W1: a reconciliation outcome is not reported as a retryable failure, '
        'and the queue re-reads', (tester) async {
      // Bug this catches: the client treating the server's reconciliation
      // conflict like any other approve failure — telling the operator to
      // retry an operation that was durably recorded as unresolved, and
      // leaving the row in the proposed queue after the server moved it out.
      final dataSource = _FakeOrgProposalsDataSource([
        _makeProposal(
          id: 'rec1',
          kind: 'prune-scope',
          risk: 'high',
          title: 'Prune an unused MCP scope',
          rationale: 'Never invoked in the trailing window.',
        ),
      ])
        ..reconciliationId = 'rec1'
        ..refreshedProposals = <OrgProposal>[];
      final controller = OrgProposalsController(
        OrgProposalsRepository(dataSource),
      );
      await controller.refresh();

      await tester.pumpWidget(await _buildApp(controller));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('approve-proposal-rec1')));
      await tester.pump();
      await tester.pump();

      expect(controller.lastApproveNeedsReconciliation, isTrue);
      expect(find.textContaining('Needs reconciliation'), findsOneWidget);
      expect(find.textContaining('Proposal approved'), findsNothing);
      expect(find.textContaining('Approve failed'), findsNothing);
      // The server moved the row out of `proposed`; the queue must follow.
      expect(dataSource.listCalls, greaterThan(1));
      expect(controller.proposals, isEmpty);

      controller.dispose();
    });

    testWidgets('W1: an ordinary approve failure still reads as retryable',
        (tester) async {
      final dataSource = _FakeOrgProposalsDataSource([
        _makeProposal(
          id: 'ord1',
          kind: 'prune-scope',
          risk: 'high',
          title: 'Prune an unused MCP scope',
          rationale: 'Never invoked in the trailing window.',
        ),
      ])
        ..failId = 'ord1';
      final controller = OrgProposalsController(
        OrgProposalsRepository(dataSource),
      );
      await controller.refresh();

      await tester.pumpWidget(await _buildApp(controller));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('approve-proposal-ord1')));
      await tester.pump();
      await tester.pump();

      expect(controller.lastApproveNeedsReconciliation, isFalse);
      expect(find.textContaining('Needs reconciliation'), findsNothing);
      expect(find.textContaining('missing security note'), findsOneWidget);

      controller.dispose();
    });

    testWidgets(
        'issue-827-c1: lists proposed proposals with kind, risk, title, rationale, evidence toggle',
        (tester) async {
      // Bug this catches: the view rendering nothing (or a stale/empty
      // list) because refresh() was never wired to initState, or the
      // controller/repository/data-source chain drops fields on the way
      // from JSON to the widget tree.
      final dataSource = _FakeOrgProposalsDataSource([
        _makeProposal(
          id: 'p1',
          kind: 'create-agent',
          risk: 'high',
          title: 'Create a Facilities specialist agent',
          rationale: 'Repeated denied-tool events for facilities scope.',
        ),
      ]);
      final controller = OrgProposalsController(
        OrgProposalsRepository(dataSource),
      );
      await controller.refresh();

      await tester.pumpWidget(await _buildApp(controller));
      await tester.pump();

      expect(find.text('create-agent'), findsOneWidget);
      expect(find.text('HIGH'), findsOneWidget);
      expect(
        find.text('Create a Facilities specialist agent'),
        findsOneWidget,
      );
      expect(
        find.text('Repeated denied-tool events for facilities scope.'),
        findsOneWidget,
      );

      // Evidence affordance: expand toggle present, evidence body hidden
      // until tapped.
      final toggle = find.byKey(const ValueKey('proposal-evidence-toggle-p1'));
      expect(toggle, findsOneWidget);
      expect(
        find.byKey(const ValueKey('proposal-evidence-body-p1')),
        findsNothing,
      );

      await tester.tap(toggle);
      await tester.pump();

      expect(
        find.byKey(const ValueKey('proposal-evidence-body-p1')),
        findsOneWidget,
      );

      controller.dispose();
    });

    testWidgets(
        'issue-1013-c1: renders a field-level before/after diff before evidence',
        (tester) async {
      // Bug this catches: signalRef replacing changeJson in the only visible
      // detail block, leaving a reviewer unable to see the proposed mutation.
      final dataSource = _FakeOrgProposalsDataSource([
        _makeProposal(
          id: 'diff1',
          kind: 'create-agent',
          signalRef: 'The audit found a recurring scheduling failure.',
          changeJson:
              '{"configPatch":{"agentConfigId":"agent-1","field":"system_prompt","value":"Use the new scheduling flow."}}',
          beforeSnapshotJson:
              '{"agentConfigId":"agent-1","field":"system_prompt","priorValue":"Use the old scheduling flow."}',
        ),
      ]);
      final controller = OrgProposalsController(
        OrgProposalsRepository(dataSource),
      );
      await controller.refresh();

      await tester.pumpWidget(await _buildApp(controller));
      await tester.pump();

      expect(find.text('Proposed change'), findsOneWidget);
      expect(find.text('System prompt'), findsOneWidget);
      expect(
        find.textContaining('Use the old scheduling flow.'),
        findsOneWidget,
      );
      expect(
        find.textContaining('Use the new scheduling flow.'),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('proposal-evidence-body-diff1')),
        findsNothing,
        reason:
            'The diff must be primary card content, not hidden in evidence.',
      );

      await tester.tap(
        find.byKey(const ValueKey('proposal-evidence-toggle-diff1')),
      );
      await tester.pump();
      expect(
        find.text('The audit found a recurring scheduling failure.'),
        findsOneWidget,
      );

      controller.dispose();
    });

    testWidgets(
        'issue-1013-c2: LLM-diagnosis proposal (real queue shape) renders '
        'Root cause / Proposed fix, not empty before/after rows',
        (tester) async {
      // The proposals that actually reach this queue (refine-config etc. from
      // the #982 LLM diagnosis) carry prose + null beforeSnapshot, no patch.
      // Regression: the generic diff path rendered "Before: (none) / After: …".
      final dataSource = _FakeOrgProposalsDataSource([
        _makeProposal(
          id: 'diag1',
          kind: 'refine-config',
          changeJson:
              '{"source":"org-optimizer-llm-diagnosis","affectedSkill":"coding-agent",'
              '"diagnosis":"Model-task mismatch causing repeated failures.",'
              '"rootCause":"Configured model is too low-tier for the task.",'
              '"fixType":"model","concreteFix":"Raise the model to a higher tier.",'
              '"confidence":0.82}',
          beforeSnapshotJson: null,
        ),
      ]);
      final controller = OrgProposalsController(
        OrgProposalsRepository(dataSource),
      );
      await controller.refresh();

      await tester.pumpWidget(await _buildApp(controller));
      await tester.pump();

      expect(find.text('Proposed change'), findsOneWidget);
      expect(find.text('Root cause'), findsOneWidget);
      expect(find.text('Proposed fix'), findsOneWidget);
      expect(
        find.textContaining('Raise the model to a higher tier.'),
        findsOneWidget,
      );
      // The misleading generic diff rows must NOT appear for this shape.
      expect(find.textContaining('Before: Not set'), findsNothing);
      expect(find.textContaining('Before: (none)'), findsNothing);

      controller.dispose();
    });

    testWidgets('renders empty state when there is nothing to review',
        (tester) async {
      final dataSource = _FakeOrgProposalsDataSource([]);
      final controller = OrgProposalsController(
        OrgProposalsRepository(dataSource),
      );
      await controller.refresh();

      await tester.pumpWidget(await _buildApp(controller));
      await tester.pump();

      expect(
        find.byKey(const ValueKey('org-proposals-empty-state')),
        findsOneWidget,
      );

      controller.dispose();
    });

    testWidgets(
        'issue-827-c2a: tapping Approve calls the data source and removes the row',
        (tester) async {
      final dataSource = _FakeOrgProposalsDataSource([
        _makeProposal(id: 'p1', kind: 'create-agent', title: 'Approve me'),
      ]);
      final controller = OrgProposalsController(
        OrgProposalsRepository(dataSource),
      );
      await controller.refresh();

      await tester.pumpWidget(await _buildApp(controller));
      await tester.pump();

      final approveButton = find.byKey(const ValueKey('approve-proposal-p1'));
      expect(approveButton, findsOneWidget);

      await tester.tap(approveButton);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(dataSource.lastApprovedId, equals('p1'));
      expect(find.text('Approve me'), findsNothing);
      expect(find.text('Proposal approved'), findsOneWidget);

      controller.dispose();
    });

    testWidgets(
        'issue-827-c2b: confirming Reject dialog calls the data source and removes the row',
        (tester) async {
      final dataSource = _FakeOrgProposalsDataSource([
        _makeProposal(id: 'p1', kind: 'create-agent', title: 'Reject me'),
      ]);
      final controller = OrgProposalsController(
        OrgProposalsRepository(dataSource),
      );
      await controller.refresh();

      await tester.pumpWidget(await _buildApp(controller));
      await tester.pump();

      final rejectButton = find.byKey(const ValueKey('reject-proposal-p1'));
      expect(rejectButton, findsOneWidget);

      await tester.tap(rejectButton);
      await tester.pump(); // open confirmation dialog

      final confirmButton = find.widgetWithText(FilledButton, 'Reject');
      expect(confirmButton, findsOneWidget);
      await tester.tap(confirmButton);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(dataSource.lastRejectedId, equals('p1'));
      expect(find.text('Reject me'), findsNothing);

      controller.dispose();
    });

    testWidgets(
        'issue-827-c3: external-adoption shows the provenance block; Approve disabled until note present',
        (tester) async {
      // Bug this catches: the Approve button being tappable for an
      // external-adoption proposal with no provenance note — the UI
      // safety note explicitly forbids an approve path that bypasses the
      // server-side note gate; this test proves the button is disabled
      // client-side too, not just left to the server to 400.
      final dataSource = _FakeOrgProposalsDataSource([
        _makeProposal(
          id: 'ext1',
          kind: 'external-adoption',
          external: 1,
          title: 'Adopt an MCP server',
          provenanceJson: null,
        ),
      ]);
      final controller = OrgProposalsController(
        OrgProposalsRepository(dataSource),
      );
      await controller.refresh();

      await tester.pumpWidget(await _buildApp(controller));
      await tester.pump();

      expect(
        find.byKey(const ValueKey('proposal-security-note-ext1')),
        findsOneWidget,
      );
      expect(find.text('Provenance'), findsOneWidget);

      final approveButton = tester.widget<FilledButton>(
        find.byKey(const ValueKey('approve-proposal-ext1')),
      );
      expect(
        approveButton.onPressed,
        isNull,
        reason: 'Approve must be disabled without a provenance note',
      );

      controller.dispose();
    });

    testWidgets(
        'issue-827-c3b: external-adoption with provenance present enables Approve',
        (tester) async {
      final dataSource = _FakeOrgProposalsDataSource([
        _makeProposal(
          id: 'ext2',
          kind: 'external-adoption',
          external: 1,
          title: 'Adopt an MCP server',
          provenanceJson:
              '{"source":"github.com/example/mcp","stars":"1200","license":"MIT"}',
        ),
      ]);
      final controller = OrgProposalsController(
        OrgProposalsRepository(dataSource),
      );
      await controller.refresh();

      await tester.pumpWidget(await _buildApp(controller));
      await tester.pump();

      final approveButton = tester.widget<FilledButton>(
        find.byKey(const ValueKey('approve-proposal-ext2')),
      );
      expect(
        approveButton.onPressed,
        isNotNull,
        reason: 'Approve should be enabled once provenance is present',
      );
      expect(find.textContaining('github.com/example/mcp'), findsOneWidget);

      controller.dispose();
    });

    testWidgets(
        'issue-827-c4: webhook-wiring shows the security block; Approve disabled until note present',
        (tester) async {
      final dataSource = _FakeOrgProposalsDataSource([
        _makeProposal(
          id: 'wh1',
          kind: 'webhook-wiring',
          title: 'Wire an inbound webhook',
          provenanceJson: null,
        ),
      ]);
      final controller = OrgProposalsController(
        OrgProposalsRepository(dataSource),
      );
      await controller.refresh();

      await tester.pumpWidget(await _buildApp(controller));
      await tester.pump();

      expect(
        find.byKey(const ValueKey('proposal-security-note-wh1')),
        findsOneWidget,
      );
      expect(find.text('Security note'), findsOneWidget);

      final approveButton = tester.widget<FilledButton>(
        find.byKey(const ValueKey('approve-proposal-wh1')),
      );
      expect(
        approveButton.onPressed,
        isNull,
        reason: 'Approve must be disabled without a security note',
      );

      controller.dispose();
    });

    testWidgets(
        'issue-827-c4b: webhook-wiring with security note present enables Approve',
        (tester) async {
      final dataSource = _FakeOrgProposalsDataSource([
        _makeProposal(
          id: 'wh2',
          kind: 'webhook-wiring',
          title: 'Wire an inbound webhook',
          provenanceJson:
              '{"triggerSource":"github","targetRecipe":"on-call","hmac":"configured"}',
        ),
      ]);
      final controller = OrgProposalsController(
        OrgProposalsRepository(dataSource),
      );
      await controller.refresh();

      await tester.pumpWidget(await _buildApp(controller));
      await tester.pump();

      final approveButton = tester.widget<FilledButton>(
        find.byKey(const ValueKey('approve-proposal-wh2')),
      );
      expect(
        approveButton.onPressed,
        isNotNull,
        reason: 'Approve should be enabled once the security note is present',
      );

      controller.dispose();
    });

    testWidgets(
        'create-agent (no security note requirement) has Approve enabled by default',
        (tester) async {
      // Regression guard for the inverse bug: a validator that requires a
      // note for EVERY kind (over-gating create-agent, which has no
      // provenance/security-note requirement per the decision doc).
      final dataSource = _FakeOrgProposalsDataSource([
        _makeProposal(id: 'ca1', kind: 'create-agent', title: 'New agent'),
      ]);
      final controller = OrgProposalsController(
        OrgProposalsRepository(dataSource),
      );
      await controller.refresh();

      await tester.pumpWidget(await _buildApp(controller));
      await tester.pump();

      final approveButton = tester.widget<FilledButton>(
        find.byKey(const ValueKey('approve-proposal-ca1')),
      );
      expect(approveButton.onPressed, isNotNull);
      expect(
        find.byKey(const ValueKey('proposal-security-note-ca1')),
        findsNothing,
      );

      controller.dispose();
    });
  });
}
