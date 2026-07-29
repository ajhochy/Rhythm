import '../../../app/core/utils/json_parsing.dart';

/// A single repeated escalation reason surfaced for one agent (#865).
///
/// Mirrors the server's `RepeatedMistake` (run_quality_service.ts).
class RepeatedMistake {
  RepeatedMistake({required this.message, required this.count});

  factory RepeatedMistake.fromJson(Map<String, dynamic> json) {
    return RepeatedMistake(
      message: asString(json['message']) ?? '',
      count: asInt(json['count']) ?? 0,
    );
  }

  final String message;
  final int count;
}

/// Plain-language QUALITY rollup for one agent's recent runs (#865).
///
/// DISTINCT from the per-provider SPEND view (usage budget): this answers
/// "is this agent doing a good job" rather than "how much did this cost".
/// Mirrors the server's `AgentRunQuality` (run_quality_service.ts) — see that
/// file for the exact definitions of each field, especially `wastedTokens`
/// (token waste computed distinctly from raw spend).
class AgentRunQuality {
  AgentRunQuality({
    required this.agentKind,
    required this.agentLabel,
    required this.totalRuns,
    required this.completedRuns,
    required this.escalatedRuns,
    required this.inProgressRuns,
    required this.unmeasuredRuns,
    required this.notEnoughData,
    this.completionRate,
    this.escalationRate,
    required this.totalTokens,
    required this.wastedTokens,
    this.wastePercentOfSpend,
    required this.totalUserCorrections,
    this.avgCorrectionsPerRun,
    required this.repeatedMistakes,
  });

  factory AgentRunQuality.fromJson(Map<String, dynamic> json) {
    final mistakesRaw = json['repeatedMistakes'];
    final mistakes = mistakesRaw is List
        ? mistakesRaw
              .whereType<Map<String, dynamic>>()
              .map(RepeatedMistake.fromJson)
              .toList()
        : <RepeatedMistake>[];

    return AgentRunQuality(
      agentKind: asString(json['agentKind']) ?? '',
      agentLabel:
          asString(json['agentLabel']) ??
          asString(json['agentKind']) ??
          'Unknown agent',
      totalRuns: asInt(json['totalRuns']) ?? 0,
      completedRuns: asInt(json['completedRuns']) ?? 0,
      escalatedRuns: asInt(json['escalatedRuns']) ?? 0,
      inProgressRuns: asInt(json['inProgressRuns']) ?? 0,
      unmeasuredRuns: asInt(json['unmeasuredRuns']) ?? 0,
      notEnoughData: asBool(json['notEnoughData']) ?? true,
      completionRate: asDouble(json['completionRate']),
      escalationRate: asDouble(json['escalationRate']),
      totalTokens: asInt(json['totalTokens']) ?? 0,
      wastedTokens: asInt(json['wastedTokens']) ?? 0,
      wastePercentOfSpend: asDouble(json['wastePercentOfSpend']),
      totalUserCorrections: asInt(json['totalUserCorrections']) ?? 0,
      avgCorrectionsPerRun: asDouble(json['avgCorrectionsPerRun']),
      repeatedMistakes: mistakes,
    );
  }

  final String agentKind;
  final String agentLabel;
  final int totalRuns;
  final int completedRuns;
  final int escalatedRuns;
  final int inProgressRuns;
  final int unmeasuredRuns;

  /// True when there aren't enough measurable runs (completed + escalated) to
  /// trust the rates below. Every rate field is null in that case — never a
  /// misleading 0%/100% computed from a handful of samples.
  final bool notEnoughData;
  final double? completionRate;
  final double? escalationRate;

  /// Total tokens across ALL runs for this agent — the same basis as spend.
  final int totalTokens;

  /// Tokens spent on runs that escalated or looped without completing. A
  /// SUBSET of [totalTokens], not the same number — see the server doc.
  final int wastedTokens;
  final double? wastePercentOfSpend;

  final int totalUserCorrections;
  final double? avgCorrectionsPerRun;

  final List<RepeatedMistake> repeatedMistakes;
}

/// Top-level rollup response for GET /agents/run-quality (#865).
class RunQualityRollup {
  RunQualityRollup({
    required this.generatedAt,
    required this.windowDays,
    required this.agents,
  });

  factory RunQualityRollup.fromJson(Map<String, dynamic> json) {
    final agentsRaw = json['agents'];
    final agents = agentsRaw is List
        ? agentsRaw
              .whereType<Map<String, dynamic>>()
              .map(AgentRunQuality.fromJson)
              .toList()
        : <AgentRunQuality>[];
    return RunQualityRollup(
      generatedAt: asString(json['generatedAt']) ?? '',
      windowDays: asInt(json['windowDays']) ?? 30,
      agents: agents,
    );
  }

  final String generatedAt;
  final int windowDays;
  final List<AgentRunQuality> agents;
}
