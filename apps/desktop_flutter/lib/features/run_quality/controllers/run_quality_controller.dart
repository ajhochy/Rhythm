import 'package:flutter/foundation.dart';

import '../models/agent_run_quality.dart';
import '../repositories/run_quality_repository.dart';

enum RunQualityStatus { idle, loading, error }

class RunQualityController extends ChangeNotifier {
  RunQualityController(this._repository);

  final RunQualityRepository _repository;

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
      _status = RunQualityStatus.idle;
    } catch (e) {
      _error = e.toString();
      _status = RunQualityStatus.error;
    }
    notifyListeners();
  }
}
