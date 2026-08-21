/// D1.5 (#1430): the real mounted proposal review surface, with only HTTP
/// faked. These tests deliberately never mount a private card widget.
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/errors/app_error.dart';
import 'package:rhythm_desktop/features/agent_optimizer/controllers/org_proposals_controller.dart';
import 'package:rhythm_desktop/features/agent_optimizer/data/org_proposals_data_source.dart';
import 'package:rhythm_desktop/features/agent_optimizer/models/org_proposal.dart';
import 'package:rhythm_desktop/features/agent_optimizer/repositories/org_proposals_repository.dart';
import 'package:rhythm_desktop/features/agent_optimizer/views/org_proposals_view.dart';

class _FakeDataSource extends OrgProposalsDataSource {
  _FakeDataSource(this.rows);
  final List<OrgProposal> rows;
  String? approvedId;
  bool conditionalConfirmationSent = false;
  String? rejectedId;
  String? failApproveId;
  bool failList = false;
  Completer<List<OrgProposal>>? listCompleter;
  final List<String> requestedStatuses = [];

  @override
  Future<List<OrgProposal>> listProposed({String status = 'proposed'}) async {
    requestedStatuses.add(status);
    if (failList) {
      throw AppError('Could not load proposals',
          code: 'NETWORK', statusCode: 503);
    }
    final completer = listCompleter;
    if (completer != null) return completer.future;
    return rows.where((row) => row.status == status).toList();
  }

  @override
  Future<OrgProposal> approve(
    String id, {
    int? decidedByUserId,
    bool conditionalToolSafetyConfirmation = false,
  }) async {
    if (id == failApproveId) {
      throw AppError('The server refused approval',
          code: 'CONFLICT', statusCode: 409);
    }
    approvedId = id;
    conditionalConfirmationSent = conditionalToolSafetyConfirmation;
    return rows.firstWhere((row) => row.id == id);
  }

  @override
  Future<OrgProposal> reject(String id, {int? decidedByUserId}) async {
    rejectedId = id;
    return rows.firstWhere((row) => row.id == id);
  }
}

OrgProposal _tool({
  String id = 'tool-1',
  Map<String, dynamic>? safety,
  String status = 'sandbox-vetted',
}) =>
    OrgProposal.fromJson({
      'id': id,
      'kind': 'tool-install',
      'risk': 'high',
      'external': 1,
      'status': status,
      'title': 'Install safe tool',
      // This must never render for a tool-install row, even in a malformed API
      // response. Only toolSafety's dedicated server projection is displayable.
      'changeJson':
          jsonEncode({'token': 'sk-not-for-ui', 'toolName': 'raw-tool'}),
      'toolSafety': safety,
      'createdAt': '2026-08-21T00:00:00.000Z',
      'updatedAt': '2026-08-21T00:00:00.000Z',
    });

Map<String, dynamic> _safety(String verdict) => {
      'state': 'ready',
      'tool': {'name': 'safe-tool', 'packageSource': 'npm:safe-tool'},
      'verdict': verdict,
      'forbiddenPathViolations': [
        {'label': 'ssh-private-key', 'count': 1}
      ],
      'networkCalls': [
        {'host': 'registry.npmjs.org', 'count': 2}
      ],
      'workspaceWriteCount': 1,
      'credentialAccessAttemptsCount': 0,
      'scenarioAttemptsCount': 2,
      'sandboxDurationMs': 17,
      'reason': 'sandbox_candidate_failed',
    };

Future<void> _pump(
    WidgetTester tester, OrgProposalsController controller) async {
  await tester.binding.setSurfaceSize(const Size(900, 900));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    ChangeNotifierProvider.value(
      value: controller,
      child: const MaterialApp(home: OrgProposalsView()),
    ),
  );
  await tester.pump();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('D1.5 tool safety review (REAL SURFACE)', () {
    testWidgets('issue-1430-c1: renders only the closed safe projection',
        (tester) async {
      final source = _FakeDataSource([_tool(safety: _safety('safe'))]);
      final controller = OrgProposalsController(OrgProposalsRepository(source));
      await controller.refresh();
      await _pump(tester, controller);

      expect(find.byKey(const ValueKey('tool-safety-card-tool-1')),
          findsOneWidget);
      expect(find.text('Tool safety'), findsOneWidget);
      expect(find.text('Safe'), findsOneWidget);
      expect(find.text('safe-tool'), findsOneWidget);
      expect(find.text('npm:safe-tool'), findsOneWidget);
      expect(find.text('ssh-private-key: 1'), findsOneWidget);
      expect(find.text('registry.npmjs.org: 2'), findsOneWidget);
      expect(find.textContaining('sk-not-for-ui'), findsNothing);
      expect(find.textContaining('raw-tool'), findsNothing);
      expect(
          tester
              .getSemantics(
                  find.byKey(const ValueKey('tool-safety-verdict-tool-1')))
              .label,
          contains('Safe'));
      controller.dispose();
    });

    testWidgets(
        'issue-1430-c2: conditional approval requires an explicit confirmation',
        (tester) async {
      final source = _FakeDataSource([_tool(safety: _safety('conditional'))]);
      final controller = OrgProposalsController(OrgProposalsRepository(source));
      await controller.refresh();
      await _pump(tester, controller);

      final approve = find.byKey(const ValueKey('approve-proposal-tool-1'));
      await tester.ensureVisible(approve);
      await tester.tap(approve);
      await tester.pump();
      expect(find.text('Approve conditional tool install?'), findsOneWidget);
      expect(source.approvedId, isNull,
          reason: 'opening a dialog must never approve');
      await tester.tap(find.text('Cancel'));
      await tester.pump();
      expect(source.approvedId, isNull,
          reason: 'a cancelled confirmation cannot survive refresh');

      await tester.ensureVisible(approve);
      await tester.tap(approve);
      await tester.pump();
      await tester.tap(
          find.byKey(const ValueKey('confirm-conditional-approve-tool-1')));
      await tester.pump();
      expect(source.approvedId, 'tool-1');
      expect(source.conditionalConfirmationSent, isTrue);
      expect(find.text('Proposal approved'), findsOneWidget);
      controller.dispose();
    });

    testWidgets('a conditional confirmation is discarded after refresh',
        (tester) async {
      final source = _FakeDataSource([_tool(safety: _safety('conditional'))]);
      final controller = OrgProposalsController(OrgProposalsRepository(source));
      await controller.refresh();
      await _pump(tester, controller);
      final approve = find.byKey(const ValueKey('approve-proposal-tool-1'));
      await tester.ensureVisible(approve);
      await tester.tap(approve);
      await tester.pump();
      await controller.refresh();
      await tester.pump();
      await tester.tap(
        find.byKey(const ValueKey('confirm-conditional-approve-tool-1')),
      );
      await tester.pump();
      expect(source.approvedId, isNull);
      expect(find.textContaining('proposal changed'), findsOneWidget);
      controller.dispose();
    });

    for (final testCase
        in <({String id, Map<String, dynamic>? safety, String status})>[
      (id: 'unsafe', safety: _safety('unsafe'), status: 'sandbox-vetted'),
      (id: 'unknown', safety: _safety('unknown'), status: 'sandbox-vetted'),
      (id: 'missing', safety: null, status: 'pending'),
      (
        id: 'malformed',
        safety: {'state': 'malformed', 'verdict': 'unknown'},
        status: 'pending'
      ),
    ]) {
      testWidgets('blocks ${testCase.id} safety reports', (tester) async {
        final source = _FakeDataSource([
          _tool(
              id: testCase.id,
              safety: testCase.safety,
              status: testCase.status),
        ]);
        final controller =
            OrgProposalsController(OrgProposalsRepository(source));
        await controller.refresh();
        await _pump(tester, controller);
        final button = tester.widget<FilledButton>(
          find.byKey(ValueKey('approve-proposal-${testCase.id}')),
        );
        expect(button.onPressed, isNull,
            reason: '${testCase.id} must be fail-closed');
        expect(
          find.byKey(ValueKey('tool-safety-blocked-${testCase.id}')),
          findsOneWidget,
        );
        controller.dispose();
      });
    }

    testWidgets('non-tool proposals retain the existing approval behavior',
        (tester) async {
      final source = _FakeDataSource([
        OrgProposal(
          id: 'plain',
          kind: 'create-agent',
          risk: 'high',
          external: 0,
          status: 'proposed',
          title: 'Unchanged proposal',
          createdAt: '2026-08-21T00:00:00.000Z',
          updatedAt: '2026-08-21T00:00:00.000Z',
        ),
      ]);
      final controller = OrgProposalsController(OrgProposalsRepository(source));
      await controller.refresh();
      await _pump(tester, controller);
      expect(
          tester
              .widget<FilledButton>(
                  find.byKey(const ValueKey('approve-proposal-plain')))
              .onPressed,
          isNotNull);
      controller.dispose();
    });

    testWidgets(
        'shows loading then an error retry state without a stale report',
        (tester) async {
      final source = _FakeDataSource([])
        ..listCompleter = Completer<List<OrgProposal>>();
      final controller = OrgProposalsController(OrgProposalsRepository(source));
      final refresh = controller.refresh();
      await _pump(tester, controller);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      source.listCompleter!.completeError(
        AppError('Could not load proposals', code: 'NETWORK', statusCode: 503),
      );
      await refresh;
      await tester.pump();
      expect(find.textContaining('Could not load proposals'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
      controller.dispose();
    });

    testWidgets(
        'issue-1430-c3: deny confirms, uses reject, and reports success',
        (tester) async {
      final source = _FakeDataSource([_tool(safety: _safety('safe'))]);
      final controller = OrgProposalsController(OrgProposalsRepository(source));
      await controller.refresh();
      await _pump(tester, controller);
      final reject = find.byKey(const ValueKey('reject-proposal-tool-1'));
      await tester.ensureVisible(reject);
      await tester.tap(reject);
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, 'Reject'));
      await tester.pump();
      expect(source.rejectedId, 'tool-1');
      expect(find.text('Proposal rejected'), findsOneWidget);
      controller.dispose();
    });

    testWidgets(
        'server refusal preserves every review status after reconciliation',
        (tester) async {
      final source = _FakeDataSource([
        _tool(id: 'vetted', safety: _safety('safe')),
        _tool(id: 'pending', safety: null, status: 'pending'),
        OrgProposal(
          id: 'proposed',
          kind: 'create-agent',
          risk: 'high',
          external: 0,
          status: 'proposed',
          title: 'Still proposed',
          createdAt: '2026-08-21T00:00:00.000Z',
          updatedAt: '2026-08-21T00:00:00.000Z',
        ),
      ])
        ..failApproveId = 'vetted';
      final controller = OrgProposalsController(OrgProposalsRepository(source));
      await controller.refresh();
      await _pump(tester, controller);
      expect(
        controller.proposals.map((proposal) => proposal.status),
        containsAll(<String>['proposed', 'sandbox-vetted', 'pending']),
      );
      source.requestedStatuses.clear();
      final approve = find.byKey(const ValueKey('approve-proposal-vetted'));
      await tester.ensureVisible(approve);
      await tester.tap(approve);
      await tester.pumpAndSettle();
      expect(find.text('The server refused approval'), findsOneWidget);
      expect(
          find.byKey(const ValueKey('proposal-card-vetted')), findsOneWidget);
      expect(
        controller.proposals.map((proposal) => proposal.status),
        containsAll(<String>['proposed', 'sandbox-vetted', 'pending']),
      );
      expect(
        source.requestedStatuses,
        orderedEquals(<String>[
          'proposed',
          'sandbox-vetted',
          'pending',
        ]),
        reason: 'the failed approval must reconcile through the full queue',
      );
      controller.dispose();
    });
  });
}
