/// REAL-SURFACE widget tests for [RunQualityView] (#865 — plain-language
/// QUALITY scorecard for recent agent runs).
///
/// These pump the MOUNTED view inside a MaterialApp with a real
/// [RunQualityController] backed by a FAKE [RunQualityDataSource]. No
/// isolated widget stubs.
///
/// Asserts:
///   1. A healthy agent's card shows completion, waste, and correction lines
///      in plain language (no raw jargon-only percentages).
///   2. Thin-history agents show "not enough data" instead of a misleading
///      rate.
///   3. An agent with unmeasured runs surfaces a distinct note rather than
///      dropping those runs or treating them as passing.
///   4. Repeated mistakes render as a distinct block.
///   5. Empty / loading / error states render without crashing.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/features/run_quality/controllers/run_quality_controller.dart';
import 'package:rhythm_desktop/features/run_quality/data/applied_changes_data_source.dart';
import 'package:rhythm_desktop/features/run_quality/data/run_quality_data_source.dart';
import 'package:rhythm_desktop/features/run_quality/models/agent_run_quality.dart';
import 'package:rhythm_desktop/features/run_quality/repositories/run_quality_repository.dart';
import 'package:rhythm_desktop/features/run_quality/views/run_quality_view.dart';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class _FakeRunQualityDataSource extends RunQualityDataSource {
  _FakeRunQualityDataSource(this._rollup);

  final RunQualityRollup? _rollup;
  bool throwOnGet = false;
  Exception? Function()? errorFactory;

  @override
  Future<RunQualityRollup> getRollup({int? windowDays}) async {
    if (throwOnGet) {
      throw errorFactory?.call() ?? Exception('boom');
    }
    return _rollup ??
        RunQualityRollup(generatedAt: '', windowDays: 30, agents: []);
  }
}

class _FakeAppliedChangesDataSource extends AppliedChangesDataSource {
  _FakeAppliedChangesDataSource([this._proposals = const []]);

  final List<Map<String, dynamic>> _proposals;
  bool throwOnGet = false;

  @override
  Future<List<Map<String, dynamic>>> listAppliedChanges() async {
    if (throwOnGet) throw Exception('proposals unavailable');
    return _proposals;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

AgentRunQuality _healthyAgent() => AgentRunQuality(
      agentKind: 'claude-code',
      agentLabel: 'Claude Code',
      totalRuns: 10,
      completedRuns: 9,
      escalatedRuns: 1,
      inProgressRuns: 0,
      unmeasuredRuns: 0,
      notEnoughData: false,
      completionRate: 0.9,
      escalationRate: 0.1,
      totalTokens: 100000,
      wastedTokens: 2000,
      wastePercentOfSpend: 0.02,
      totalUserCorrections: 1,
      avgCorrectionsPerRun: 0.1,
      repeatedMistakes: const [],
    );

AgentRunQuality _thinHistoryAgent() => AgentRunQuality(
      agentKind: 'gemini-cli',
      agentLabel: 'Gemini CLI',
      totalRuns: 2,
      completedRuns: 1,
      escalatedRuns: 1,
      inProgressRuns: 0,
      unmeasuredRuns: 0,
      notEnoughData: true,
      completionRate: null,
      escalationRate: null,
      totalTokens: 500,
      wastedTokens: 0,
      wastePercentOfSpend: null,
      totalUserCorrections: 0,
      avgCorrectionsPerRun: null,
      repeatedMistakes: const [],
    );

AgentRunQuality _unmeasuredAgent() => AgentRunQuality(
      agentKind: 'codex',
      agentLabel: 'Codex',
      totalRuns: 7,
      completedRuns: 5,
      escalatedRuns: 1,
      inProgressRuns: 0,
      unmeasuredRuns: 1,
      notEnoughData: false,
      completionRate: 5 / 6,
      escalationRate: 1 / 6,
      totalTokens: 40000,
      wastedTokens: 500,
      wastePercentOfSpend: 0.0125,
      totalUserCorrections: 0,
      avgCorrectionsPerRun: 0,
      repeatedMistakes: const [],
    );

AgentRunQuality _repeatOffenderAgent() => AgentRunQuality(
      agentKind: 'claude-code',
      agentLabel: 'Claude Code',
      totalRuns: 8,
      completedRuns: 4,
      escalatedRuns: 4,
      inProgressRuns: 0,
      unmeasuredRuns: 0,
      notEnoughData: false,
      completionRate: 0.5,
      escalationRate: 0.5,
      totalTokens: 20000,
      wastedTokens: 10000,
      wastePercentOfSpend: 0.5,
      totalUserCorrections: 6,
      avgCorrectionsPerRun: 0.75,
      repeatedMistakes: [
        RepeatedMistake(
            message: 'tool call failed: permission denied', count: 3),
      ],
    );

Widget _buildApp(RunQualityController controller) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<RunQualityController>.value(value: controller),
    ],
    child: const MaterialApp(home: RunQualityView()),
  );
}

RunQualityController _controllerFor(
  List<AgentRunQuality> agents, {
  List<Map<String, dynamic>> proposals = const [],
  bool changesFail = false,
}) {
  final ds = _FakeRunQualityDataSource(
    RunQualityRollup(generatedAt: 'now', windowDays: 30, agents: agents),
  );
  final changes = _FakeAppliedChangesDataSource(proposals)
    ..throwOnGet = changesFail;
  return RunQualityController(
    RunQualityRepository(ds),
    appliedChanges: changes,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('RunQualityView — plain-language agent scorecard (#865)', () {
    testWidgets(
        'shows completion, waste, and correction lines for a healthy agent', (
      tester,
    ) async {
      final controller = _controllerFor([_healthyAgent()]);
      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(find.text('Claude Code'), findsOneWidget);
      // Completion line — plain language, not a bare "90%".
      expect(find.textContaining('Finished the job'), findsOneWidget);
      expect(find.textContaining('90%'), findsOneWidget);
      // Waste line is present and distinct from completion.
      expect(find.byKey(const ValueKey('waste-row')), findsOneWidget);
      expect(find.textContaining('Wasted'), findsOneWidget);
      // Corrections line.
      expect(find.byKey(const ValueKey('corrections-row')), findsOneWidget);
    });

    testWidgets('thin-history agent shows "not enough data" instead of a rate',
        (
      tester,
    ) async {
      final controller = _controllerFor([_thinHistoryAgent()]);
      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(
          find.byKey(const ValueKey('not-enough-data-banner')), findsOneWidget);
      expect(find.textContaining('Not enough runs yet'), findsOneWidget);
      // Must NOT show a misleading completion rate for this agent.
      expect(find.byKey(const ValueKey('completion-row')), findsNothing);
    });

    testWidgets('unmeasured runs are surfaced distinctly, not silently dropped',
        (
      tester,
    ) async {
      final controller = _controllerFor([_unmeasuredAgent()]);
      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('unmeasured-note')), findsOneWidget);
      expect(find.textContaining("couldn't be scored"), findsOneWidget);
    });

    testWidgets('repeated mistakes render as a distinct block', (tester) async {
      final controller = _controllerFor([_repeatOffenderAgent()]);
      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('repeated-mistakes-block')),
          findsOneWidget);
      expect(
          find.textContaining('Keeps making the same mistake'), findsOneWidget);
      expect(find.textContaining('permission denied'), findsOneWidget);
      expect(find.textContaining('3×'), findsOneWidget);
    });

    testWidgets('empty state renders when there are no runs yet',
        (tester) async {
      final controller = _controllerFor([]);
      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('run-quality-empty-state')),
          findsOneWidget);
    });

    testWidgets('error state renders with a retry button', (tester) async {
      final ds = _FakeRunQualityDataSource(null)..throwOnGet = true;
      final controller = RunQualityController(
        RunQualityRepository(ds),
        appliedChanges: _FakeAppliedChangesDataSource(),
      );
      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets('multiple agents each render their own card', (tester) async {
      final controller = _controllerFor([_healthyAgent(), _thinHistoryAgent()]);
      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(
        find.byKey(ValueKey('run-quality-card-${_healthyAgent().agentKind}')),
        findsOneWidget,
      );
      expect(
        find.byKey(
            ValueKey('run-quality-card-${_thinHistoryAgent().agentKind}')),
        findsOneWidget,
      );
    });
  });

  group('RunQualityView — applied-changes summary (READ-ONLY)', () {
    Map<String, dynamic> proposal(
      String agentKind,
      String status, [
      String? outcomeStatus,
    ]) =>
        {
          'id': '$agentKind-$status-${outcomeStatus ?? 'x'}',
          'targetRef': 'agent_config:$agentKind',
          'status': status,
          if (outcomeStatus != null) 'outcomeStatus': outcomeStatus,
        };

    testWidgets('summarises changes applied to that agent in plain language',
        (tester) async {
      final controller = _controllerFor(
        [_healthyAgent()],
        proposals: [
          proposal('claude-code', 'active', 'verified'),
          proposal('claude-code', 'applied', 'unproven'),
          proposal('claude-code', 'measuring', 'unproven'),
        ],
      );
      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('applied-changes-claude-code')),
          findsOneWidget);
      expect(
        find.textContaining('3 changes to this agent are switched on'),
        findsOneWidget,
      );
      expect(find.textContaining('2 not measured yet'), findsOneWidget);
      expect(find.textContaining('1 helped'), findsOneWidget);
    });

    testWidgets('shows nothing for an agent with no applied changes',
        (tester) async {
      final controller = _controllerFor(
        [_healthyAgent()],
        proposals: [proposal('codex', 'active')],
      );
      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('applied-changes-claude-code')),
          findsNothing);
      expect(find.textContaining('switched on right now'), findsNothing);
    });

    testWidgets('offers no way to act on a change — reporting only',
        (tester) async {
      final controller = _controllerFor(
        [_healthyAgent()],
        proposals: [proposal('claude-code', 'active', 'verified')],
      );
      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('applied-changes-claude-code')),
          findsOneWidget);
      // No approve / revert / undo affordance anywhere on the report card.
      expect(find.byType(FilledButton), findsNothing);
      expect(find.byType(TextButton), findsNothing);
      expect(find.byType(ElevatedButton), findsNothing);
      expect(find.byType(OutlinedButton), findsNothing);
      expect(find.byType(Switch), findsNothing);
      expect(find.byType(Checkbox), findsNothing);
    });

    testWidgets('report card still renders when the change list is unavailable',
        (tester) async {
      final controller = _controllerFor(
        [_healthyAgent()],
        changesFail: true,
      );
      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(find.text('Claude Code'), findsOneWidget);
      expect(find.byKey(const ValueKey('applied-changes-claude-code')),
          findsNothing);
    });
  });
}
