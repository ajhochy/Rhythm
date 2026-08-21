import '../../../app/core/utils/json_parsing.dart';

/// D3.2 — the three verdicts a human may report on a run, mirroring the
/// server's `UserVerdict` (models/agent_run_outcome.ts). `inconclusive` is a
/// finalizer-only outcome and is deliberately not a member here — a human
/// never reports it.
enum RunFeedbackVerdict {
  success('success'),
  partial('partial'),
  failure('failure');

  final String wireValue;
  const RunFeedbackVerdict(this.wireValue);

  static RunFeedbackVerdict? fromWire(String? s) {
    for (final v in RunFeedbackVerdict.values) {
      if (v.wireValue == s) return v;
    }
    return null;
  }
}

/// The slice of the server's `AgentRunOutcomeView`
/// (GET /agent-run-outcomes/:sessionId) the session-detail feedback surface
/// needs: only the latest explicit_user verdict. A run with no explicit
/// feedback yet is [explicitUserVerdict] == null — absence, never a guessed
/// default.
class RunOutcomeFeedback {
  const RunOutcomeFeedback({this.explicitUserVerdict});

  final RunFeedbackVerdict? explicitUserVerdict;

  factory RunOutcomeFeedback.fromJson(Map<String, dynamic> json) {
    return RunOutcomeFeedback(
      explicitUserVerdict:
          RunFeedbackVerdict.fromWire(asString(json['explicitUserVerdict'])),
    );
  }
}
