/// Applied-changes tab on the optimizer review surface.
///
/// Same convention as `org_proposals_view_test.dart`: every test pumps the
/// REAL, MOUNTED `OrgProposalsView` with a fake data source underneath the
/// real repository/controller chain — the fake is the only faked boundary.
///
/// Covers:
///  - the second tab lists the already-applied (live) proposals;
///  - deployment state and outcome state render as two SEPARATE facts;
///  - a legacy-snapshot row offers NO Revert and explains why in plain words;
///  - a canonical (scope-*-v2) active row offers Revert and calls the data
///    source;
///  - the server stays authoritative: a 409 from revert surfaces the server's
///    own message rather than a generic failure.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/errors/app_error.dart';
import 'package:rhythm_desktop/features/agent_optimizer/controllers/org_proposals_controller.dart';
import 'package:rhythm_desktop/features/agent_optimizer/data/org_proposals_data_source.dart';
import 'package:rhythm_desktop/features/agent_optimizer/models/org_proposal.dart';
import 'package:rhythm_desktop/features/agent_optimizer/repositories/org_proposals_repository.dart';
import 'package:rhythm_desktop/features/agent_optimizer/views/org_proposals_view.dart';

// ---------------------------------------------------------------------------
// Fake data source — keyed by the status filter the server accepts.
// ---------------------------------------------------------------------------

class _FakeOrgProposalsDataSource extends OrgProposalsDataSource {
  _FakeOrgProposalsDataSource(this.byStatus);

  final Map<String, List<OrgProposal>> byStatus;

  final List<String> listedStatuses = [];
  String? lastRevertedId;

  /// If set, revert() throws the server's legacy-snapshot 409 for this id.
  String? legacyConflictId;

  @override
  Future<List<OrgProposal>> listProposed({String status = 'proposed'}) async {
    listedStatuses.add(status);
    return byStatus[status] ?? const [];
  }

  @override
  Future<OrgProposal> revert(String id) async {
    if (id == legacyConflictId) {
      throw AppError(
        'Proposal $id uses an unsafe legacy scope snapshot; no changes were '
        'made and operator reconciliation is required',
        code: 'CONFLICT',
        statusCode: 409,
      );
    }
    lastRevertedId = id;
    final proposal = byStatus['active']!.firstWhere((p) => p.id == id);
    byStatus['active']!.removeWhere((p) => p.id == id);
    return proposal;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

final _kEpoch = DateTime.fromMillisecondsSinceEpoch(0).toIso8601String();

/// A canonical, entry-level scope snapshot — the shape the server can revert.
const _canonicalSnapshot =
    '{"version":"scope-delta-v2","field":"allowedMcpsJson"}';

/// The LEGACY whole-field snapshot 109 of ~117 live rows actually carry.
const _legacySnapshot =
    '{"agentConfigId":"agent-1","field":"allowedMcpsJson","priorValue":"[\\"rhythm\\"]"}';

OrgProposal _applied({
  required String id,
  String status = 'active',
  String outcomeStatus = 'unproven',
  String kind = 'prune-scope',
  String title = 'Pruned an unused tool',
  String? beforeSnapshotJson = _canonicalSnapshot,
}) {
  return OrgProposal(
    id: id,
    kind: kind,
    risk: 'low',
    external: 0,
    status: status,
    outcomeStatus: outcomeStatus,
    title: title,
    rationale: 'Never used in the trailing window.',
    beforeSnapshotJson: beforeSnapshotJson,
    createdAt: _kEpoch,
    updatedAt: _kEpoch,
  );
}

Future<void> _pumpAppliedTab(
  WidgetTester tester,
  OrgProposalsController controller,
) async {
  // Tear the previous tree down first: pumpWidget reuses elements, and a
  // retained _AppliedTab State would skip its initState load for a fresh
  // controller.
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<OrgProposalsController>.value(value: controller),
      ],
      child: const MaterialApp(home: OrgProposalsView()),
    ),
  );
  await tester.pump();
  await tester.tap(find.byKey(const ValueKey('org-proposals-tab-applied')));
  await tester.pumpAndSettle();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('OrgProposalsView applied tab (REAL SURFACE)', () {
    testWidgets('lists the changes that are already live', (tester) async {
      final dataSource = _FakeOrgProposalsDataSource({
        'proposed': <OrgProposal>[],
        'active': [_applied(id: 'a1', title: 'Pruned an unused tool')],
        'applied': [
          _applied(id: 'a2', status: 'applied', title: 'Just landed')
        ],
        'measuring': [
          _applied(id: 'a3', status: 'measuring', title: 'Being checked'),
        ],
      });
      final controller =
          OrgProposalsController(OrgProposalsRepository(dataSource));

      await _pumpAppliedTab(tester, controller);

      expect(find.text('Pruned an unused tool'), findsOneWidget);
      expect(find.text('Just landed'), findsOneWidget);
      await tester.drag(
        find.byKey(const ValueKey('applied-proposals-list')),
        const Offset(0, -400),
      );
      await tester.pumpAndSettle();
      expect(find.text('Being checked'), findsOneWidget);
      expect(dataSource.listedStatuses, contains('active'));
      expect(dataSource.listedStatuses, contains('applied'));
      expect(dataSource.listedStatuses, contains('measuring'));

      controller.dispose();
    });

    testWidgets(
        'deployment state and outcome state are two separate facts, not one label',
        (tester) async {
      // A change can be live AND unmeasured at the same time; collapsing the
      // two into a single label is exactly the defect this guards.
      final dataSource = _FakeOrgProposalsDataSource({
        'active': [_applied(id: 'a1')],
      });
      final controller =
          OrgProposalsController(OrgProposalsRepository(dataSource));

      await _pumpAppliedTab(tester, controller);

      expect(find.text('In use now'), findsOneWidget);
      expect(find.text('Not measured yet'), findsOneWidget);

      controller.dispose();
    });

    testWidgets('renders each outcome value in plain language', (tester) async {
      const expected = {
        'unproven': 'Not measured yet',
        'inconclusive': 'Checked, but no clear difference',
        'verified': 'Checked — it helped',
        'regressed': 'Checked — it made things worse',
      };
      for (final entry in expected.entries) {
        final dataSource = _FakeOrgProposalsDataSource({
          'active': [_applied(id: 'a1', outcomeStatus: entry.key)],
        });
        final controller =
            OrgProposalsController(OrgProposalsRepository(dataSource));

        await _pumpAppliedTab(tester, controller);

        expect(
          find.text(entry.value),
          findsOneWidget,
          reason: 'outcome ${entry.key} should read as "${entry.value}"',
        );
        // No jargon leaks through.
        expect(find.textContaining(entry.key), findsNothing);

        controller.dispose();
      }
    });

    testWidgets('a legacy-snapshot row offers no Revert and explains why',
        (tester) async {
      final dataSource = _FakeOrgProposalsDataSource({
        'active': [
          _applied(id: 'legacy1', beforeSnapshotJson: _legacySnapshot)
        ],
      });
      final controller =
          OrgProposalsController(OrgProposalsRepository(dataSource));

      await _pumpAppliedTab(tester, controller);

      expect(
        find.byKey(const ValueKey('revert-proposal-legacy1')),
        findsNothing,
        reason: 'the server refuses this revert with a 409 every time',
      );
      expect(
        find.byKey(const ValueKey('revert-blocked-legacy1')),
        findsOneWidget,
      );
      expect(find.textContaining("can't be undone from here"), findsOneWidget);

      controller.dispose();
    });

    testWidgets('a canonical row offers Revert and calls the data source',
        (tester) async {
      final dataSource = _FakeOrgProposalsDataSource({
        'active': [_applied(id: 'ok1', title: 'Undo me')],
      });
      final controller =
          OrgProposalsController(OrgProposalsRepository(dataSource));

      await _pumpAppliedTab(tester, controller);

      final revert = find.byKey(const ValueKey('revert-proposal-ok1'));
      expect(revert, findsOneWidget);

      await tester.tap(revert);
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, 'Undo change'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(dataSource.lastRevertedId, equals('ok1'));
      expect(find.text('Undo me'), findsNothing);

      controller.dispose();
    });

    testWidgets('a 409 from the server surfaces the server message',
        (tester) async {
      // The client-side legacy check is a UX aid; the SERVER is the authority.
      // A row that looks revertable but is refused must show what the server
      // said, not "Revert failed".
      final dataSource = _FakeOrgProposalsDataSource({
        'active': [_applied(id: 'ok1', title: 'Looks fine')],
      })
        ..legacyConflictId = 'ok1';
      final controller =
          OrgProposalsController(OrgProposalsRepository(dataSource));

      await _pumpAppliedTab(tester, controller);

      await tester.tap(find.byKey(const ValueKey('revert-proposal-ok1')));
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, 'Undo change'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(
        find.textContaining('operator reconciliation is required'),
        findsOneWidget,
      );
      expect(find.textContaining('Revert failed'), findsNothing);
      // The row stays: nothing was undone.
      expect(find.text('Looks fine'), findsOneWidget);

      controller.dispose();
    });

    testWidgets('renders an empty state when nothing has been applied yet',
        (tester) async {
      final dataSource = _FakeOrgProposalsDataSource({});
      final controller =
          OrgProposalsController(OrgProposalsRepository(dataSource));

      await _pumpAppliedTab(tester, controller);

      expect(
        find.byKey(const ValueKey('applied-proposals-empty-state')),
        findsOneWidget,
      );

      controller.dispose();
    });
  });
}
