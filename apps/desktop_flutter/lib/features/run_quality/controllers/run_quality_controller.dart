import 'package:flutter/foundation.dart';

import '../data/applied_changes_data_source.dart';
import '../models/agent_run_quality.dart';
import '../models/applied_change_summary.dart';
import '../repositories/run_quality_repository.dart';

enum RunQualityStatus { idle, loading, error }

class RunQualityController extends ChangeNotifier {
  RunQualityController(this._repository,
      {AppliedChangesDataSource? appliedChanges})
      : _appliedChanges = appliedChanges ?? AppliedChangesDataSource();

  final RunQualityRepository _repository;

  // ponytail: no repository wrapper — it would be a one-line passthrough.
  final AppliedChangesDataSource _appliedChanges;

  Map<String, AppliedChangeSummary> _changesByAgent = const {};

  /// READ-ONLY summary of org-optimizer changes applied to [agentKind], or
  /// null when there is nothing to report (or the list couldn't be loaded).
  AppliedChangeSummary? changesFor(String agentKind) =>
      _changesByAgent[agentKind];

  RunQualityRollup? _rollup;
  RunQualityStatus _status = RunQualityStatus.idle;
  String? _error;

  RunQualityRollup? get rollup => _rollup;
  List<AgentRunQuality> get agents => _rollup?.agents ?? const [];
  RunQualityStatus get status => _status;
  String? get error => _error;

  Future<void> refresh({int? windowDays}) async {
    _status = RunQualityStatus.loading;
    _error = null;
    notifyListeners();

    try {
      _rollup = await _repository.getRollup(windowDays: windowDays);
      _changesByAgent = await _loadAppliedChanges();
      _status = RunQualityStatus.idle;
    } catch (e) {
      _error = e.toString();
      _status = RunQualityStatus.error;
    }
    notifyListeners();
  }

  /// The applied-changes summary is a bonus line on the card, not the card.
  /// If the proposal list can't be read, report nothing rather than failing
  /// the whole scorecard or showing counts we can't stand behind.
  Future<Map<String, AppliedChangeSummary>> _loadAppliedChanges() async {
    try {
      return summarizeAppliedChanges(
          await _appliedChanges.listAppliedChanges());
    } catch (e) {
      debugPrint('[run-quality] applied-changes summary unavailable: $e');
      return const {};
    }
  }
}
