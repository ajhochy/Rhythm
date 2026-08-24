/// READ-ONLY rollup of org-optimizer changes that have been applied to one
/// agent, for the Agent Report Card (#865).
///
/// Reporting only — nothing here approves, reverts, or otherwise mutates a
/// change. It reads the same proposal rows the review queue reads and counts
/// them; the report card is never wired into the auto-tune loop (#816).
///
/// TWO INDEPENDENT AXES, deliberately never merged into one label:
///   - DEPLOYMENT (`status`): is this change live right now? `applied`,
///     `measuring` and `active` all mean live; `reverted` means it was undone.
///     `proposed`/`approved`/`rejected`/`failed` are not deployments of a
///     change and are ignored.
///   - OUTCOME (`outcomeStatus`): did it help? `unproven` (the default, and in
///     practice almost everything today) means NOTHING HAS BEEN MEASURED — it
///     is not a bad score, not a 0%, not a verdict. Only `verified` and
///     `regressed` are verdicts, and only the experiment service can write
///     them.
library;

import '../../../app/core/utils/json_parsing.dart';

/// Deployment statuses that mean "this change is live on the agent".
const _liveStatuses = {'applied', 'measuring', 'active'};

class AppliedChangeSummary {
  const AppliedChangeSummary({
    this.live = 0,
    this.notMeasured = 0,
    this.noDifference = 0,
    this.helped = 0,
    this.madeWorse = 0,
    this.undone = 0,
  });

  /// Changes currently live on this agent (applied + measuring + active).
  final int live;

  /// Of the live changes: outcome not measured yet (`unproven`/absent).
  final int notMeasured;

  /// Of the live changes: measured, no clear difference (`inconclusive`).
  final int noDifference;

  /// Of the live changes: measured and better (`verified`).
  final int helped;

  /// Of the live changes: measured and worse (`regressed`).
  final int madeWorse;

  /// Changes that were applied and later undone (`reverted`).
  final int undone;

  bool get isEmpty => live == 0 && undone == 0;

  /// Plain-language lines for a non-technical reader. Empty when there is
  /// nothing to report — the card shows no row at all rather than a zero row.
  List<String> get sentences {
    if (isEmpty) return const [];

    final lines = <String>[];
    if (live > 0) {
      lines.add(live == 1
          ? '1 change to this agent is switched on right now'
          : '$live changes to this agent are switched on right now');

      // Outcome, kept separate from the "it's live" line above.
      final parts = <String>[
        if (notMeasured > 0) '$notMeasured not measured yet',
        if (helped > 0) '$helped helped',
        if (noDifference > 0) '$noDifference made no clear difference',
        if (madeWorse > 0) '$madeWorse made things worse',
      ];
      if (parts.isNotEmpty) lines.add(parts.join(' · '));
    }
    if (undone > 0) {
      lines.add(undone == 1
          ? '1 earlier change was undone'
          : '$undone earlier changes were undone');
    }
    return lines;
  }
}

/// Groups raw proposal JSON by the agent it targets.
///
/// ATTRIBUTION: proposals have no agent_config_id column, so the target agent
/// is read out of `targetRef`, which generators write as
/// `agent_config:<agent_configs.id>` optionally followed by `:<scope>:<name>`
/// (see scope_hygiene/delegation/workflow_signal/new_agent generators). That
/// id is the same value the run-quality rollup calls `agentKind` (it looks up
/// `agent_configs.label` by it), so the two join directly.
///
/// Anything not in that exact shape — a skill/recipe/server target, a null or
/// empty ref — is DROPPED, never guessed at. An agent with nothing attributed
/// to it simply gets no row.
Map<String, AppliedChangeSummary> summarizeAppliedChanges(
  Iterable<dynamic> proposals,
) {
  final counts = <String,
      List<int>>{}; // [live, notMeasured, noDiff, helped, worse, undone]

  for (final raw in proposals) {
    if (raw is! Map<String, dynamic>) continue;
    final agentKind = _agentKindFromTargetRef(asString(raw['targetRef']));
    if (agentKind == null) continue;

    final status = asString(raw['status']);
    final isLive = _liveStatuses.contains(status);
    if (!isLive && status != 'reverted') continue;

    final c = counts.putIfAbsent(agentKind, () => [0, 0, 0, 0, 0, 0]);
    if (!isLive) {
      c[5]++;
      continue;
    }
    c[0]++;
    switch (asString(raw['outcomeStatus'])) {
      case 'verified':
        c[3]++;
      case 'regressed':
        c[4]++;
      case 'inconclusive':
        c[2]++;
      default:
        // 'unproven', absent, or anything unrecognised: not measured. Never
        // read as a verdict.
        c[1]++;
    }
  }

  return counts.map(
    (agentKind, c) => MapEntry(
      agentKind,
      AppliedChangeSummary(
        live: c[0],
        notMeasured: c[1],
        noDifference: c[2],
        helped: c[3],
        madeWorse: c[4],
        undone: c[5],
      ),
    ),
  );
}

String? _agentKindFromTargetRef(String? targetRef) {
  const prefix = 'agent_config:';
  if (targetRef == null || !targetRef.startsWith(prefix)) return null;
  final rest = targetRef.substring(prefix.length);
  final id = rest.split(':').first;
  return id.isEmpty ? null : id;
}
