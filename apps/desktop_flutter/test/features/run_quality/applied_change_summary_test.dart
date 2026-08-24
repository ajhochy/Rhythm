/// Unit tests for the READ-ONLY "changes applied to this agent" rollup shown
/// on the Agent Report Card.
///
/// Covers the two things that are easy to get wrong and that matter more than
/// the feature itself:
///   1. Attribution — a proposal belongs to the agent named in `targetRef`
///      (`agent_config:<id>[:...]`), and anything that isn't in that shape is
///      DROPPED rather than guessed at.
///   2. Deployment state ("is it live") and outcome state ("did it help") are
///      counted separately and never collapsed into one number.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/run_quality/models/applied_change_summary.dart';

Map<String, dynamic> _p({
  required String targetRef,
  required String status,
  String? outcomeStatus,
}) =>
    {
      'id': 'p-$targetRef-$status-${outcomeStatus ?? 'x'}',
      'targetRef': targetRef,
      'status': status,
      if (outcomeStatus != null) 'outcomeStatus': outcomeStatus,
    };

void main() {
  group('summarizeAppliedChanges', () {
    test('attributes a proposal to the agent id inside targetRef', () {
      final byAgent = summarizeAppliedChanges([
        _p(targetRef: 'agent_config:claude-code', status: 'active'),
        _p(
          targetRef: 'agent_config:codex:mcp:rhythm',
          status: 'applied',
        ),
      ]);

      expect(byAgent['claude-code']!.live, 1);
      expect(byAgent['codex']!.live, 1);
    });

    test('drops proposals whose targetRef is not an agent config', () {
      final byAgent = summarizeAppliedChanges([
        _p(targetRef: 'skill:daily-email-triage', status: 'active'),
        _p(targetRef: '', status: 'active'),
        {'id': 'no-target', 'status': 'active'},
      ]);

      expect(byAgent, isEmpty);
    });

    test('counts deployment state separately from outcome state', () {
      final byAgent = summarizeAppliedChanges([
        _p(
          targetRef: 'agent_config:claude-code',
          status: 'active',
          outcomeStatus: 'verified',
        ),
        _p(
          targetRef: 'agent_config:claude-code',
          status: 'measuring',
          outcomeStatus: 'unproven',
        ),
        _p(
          targetRef: 'agent_config:claude-code',
          status: 'applied',
          outcomeStatus: 'inconclusive',
        ),
        _p(
          targetRef: 'agent_config:claude-code',
          status: 'reverted',
          outcomeStatus: 'regressed',
        ),
      ]);

      final s = byAgent['claude-code']!;
      // applied + measuring + active are all "live"; reverted is not.
      expect(s.live, 3);
      expect(s.undone, 1);
      // Outcome counts cover the live changes only.
      expect(s.helped, 1);
      expect(s.notMeasured, 1);
      expect(s.noDifference, 1);
      expect(s.madeWorse, 0);
    });

    test('a missing outcomeStatus counts as not measured, never as a verdict',
        () {
      final byAgent = summarizeAppliedChanges([
        _p(targetRef: 'agent_config:codex', status: 'active'),
      ]);

      final s = byAgent['codex']!;
      expect(s.notMeasured, 1);
      expect(s.helped, 0);
      expect(s.madeWorse, 0);
      expect(s.noDifference, 0);
    });

    test('ignores statuses that are not a deployment of a change', () {
      final byAgent = summarizeAppliedChanges([
        _p(targetRef: 'agent_config:codex', status: 'proposed'),
        _p(targetRef: 'agent_config:codex', status: 'rejected'),
        _p(targetRef: 'agent_config:codex', status: 'failed'),
      ]);

      expect(byAgent, isEmpty);
    });
  });

  group('AppliedChangeSummary.sentences', () {
    test('all-unproven reads as not measured yet — no verdict, no percentage',
        () {
      const s = AppliedChangeSummary(live: 3, notMeasured: 3);
      final text = s.sentences.join(' ');

      expect(text, contains('3 changes'));
      expect(text, contains('3 not measured yet'));
      expect(text, isNot(contains('%')));
      expect(text.toLowerCase(), isNot(contains('proposal')));
      expect(text.toLowerCase(), isNot(contains('outcome')));
    });

    test('mixes live count, outcomes, and undone changes as separate lines',
        () {
      const s = AppliedChangeSummary(
        live: 3,
        notMeasured: 2,
        helped: 1,
        undone: 1,
      );

      expect(s.sentences, [
        '3 changes to this agent are switched on right now',
        '2 not measured yet · 1 helped',
        '1 earlier change was undone',
      ]);
    });

    test('singular wording for a single change', () {
      const s = AppliedChangeSummary(live: 1, notMeasured: 1);

      expect(
          s.sentences.first, '1 change to this agent is switched on right now');
    });

    test('is empty when nothing has been applied to this agent', () {
      const s = AppliedChangeSummary();

      expect(s.isEmpty, isTrue);
      expect(s.sentences, isEmpty);
    });
  });
}
