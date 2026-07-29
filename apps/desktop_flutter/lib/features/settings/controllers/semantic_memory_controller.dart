import 'package:flutter/foundation.dart';

import '../data/semantic_memory_data_source.dart';

class SemanticMemoryController extends ChangeNotifier {
  SemanticMemoryController(
    this._dataSource, {
    Duration pollDelay = const Duration(milliseconds: 500),
    int maxPollAttempts = 240,
  })  : _pollDelay = pollDelay,
        _maxPollAttempts = maxPollAttempts;

  final SemanticMemoryDataSource _dataSource;
  final Duration _pollDelay;
  final int _maxPollAttempts;

  SemanticMemoryStatus? _status;
  List<SemanticMemoryCandidate> _candidates = const [];
  String? _actionFailureCategory;
  bool _isBusy = false;
  bool _disposed = false;
  int _operationGeneration = 0;

  SemanticMemoryStatus? get status => _status;
  List<SemanticMemoryCandidate> get candidates => _candidates;
  bool get isBusy => _isBusy;
  bool get hasDetectedCandidate => _candidates.isNotEmpty;
  bool get hasExecutable => _status?.hasExecutable ?? false;

  String? get effectiveFailureCategory =>
      _actionFailureCategory ?? _status?.failureCategory;

  String get displayState =>
      _actionFailureCategory == null ? (_status?.state ?? 'disabled') : 'error';

  String get stateLabel {
    switch (displayState) {
      case 'discovering':
        return 'Checking setup';
      case 'indexing':
        return 'Building local index';
      case 'starting':
        return 'Starting';
      case 'ready':
        return 'Ready';
      case 'error':
        return 'Needs attention';
      case 'disabled':
        return 'Off';
      default:
        return 'Unavailable';
    }
  }

  String get stateDescription {
    switch (displayState) {
      case 'discovering':
        return 'Rhythm is validating Engraph on this Mac. You can keep working.';
      case 'indexing':
        return "Rhythm is building its private semantic index. You can keep working.";
      case 'starting':
        return 'Secure local semantic search is starting. You can keep working.';
      case 'ready':
        return 'Local semantic search passed its health check.';
      case 'error':
        return publicFailureGuidance;
      case 'disabled':
        if (hasDetectedCandidate) {
          return 'Engraph was found on this Mac and is ready for Rhythm to validate.';
        }
        return 'Semantic Memory is off. Standard memory search remains active.';
      default:
        return 'Standard memory search remains active.';
    }
  }

  String get publicFailureGuidance {
    switch (effectiveFailureCategory) {
      case 'binary_not_found':
      case 'binary_invalid':
        return 'Engraph is not available yet. Open the install guide or choose the Engraph app. Standard memory search remains active.';
      case 'permission_denied':
        return 'macOS blocked Engraph or Rhythm’s private index. Review Privacy & Security in System Settings. Do not bypass macOS protection. Standard memory search remains active.';
      case 'index_failed':
        return 'Rhythm could not build its private semantic index. Try again or rebuild it. Standard memory search remains active.';
      case 'spawn_failed':
        return 'Engraph could not start. Try again or choose another installed copy. Standard memory search remains active.';
      case 'timeout':
      case 'health_check_failed':
        return 'Semantic Memory did not pass its local health check. Try again. Standard memory search remains active.';
      default:
        return 'Semantic Memory is temporarily unavailable. Standard memory search remains active.';
    }
  }

  Future<void> initialize() async {
    await refresh();
    if (!hasExecutable) await _discover();
  }

  Future<void> refresh() async {
    try {
      _status = await _dataSource.getStatus();
      _actionFailureCategory = null;
    } on SemanticMemoryApiException {
      _actionFailureCategory = 'unavailable';
    } catch (_) {
      _actionFailureCategory = 'unavailable';
    }
    _notify();
  }

  Future<void> enable() async {
    await _runAction(() async {
      if (!hasExecutable) {
        if (_candidates.isEmpty) await _discover(notify: false);
        if (_candidates.isEmpty) {
          _actionFailureCategory = 'binary_not_found';
          return;
        }
        await _dataSource.chooseBinary(_candidates.first.path);
        await refresh();
      }
      await _dataSource.enable();
      await _pollUntilSettled();
    });
  }

  Future<void> disable() async {
    _operationGeneration++;
    await _runAction(() async {
      await _dataSource.disable();
      await refresh();
    });
  }

  Future<void> chooseBinary(String path) async {
    if (path.trim().isEmpty) return;
    await _runAction(() async {
      await _dataSource.chooseBinary(path);
      await refresh();
    });
  }

  Future<void> checkHealth() async {
    await _runAction(() async {
      final health = await _dataSource.checkHealth();
      if (!health.ok) {
        _actionFailureCategory = health.category ?? 'health_check_failed';
      }
      await refresh();
      if (!health.ok) {
        _actionFailureCategory = health.category ?? 'health_check_failed';
      }
    });
  }

  Future<void> retry() async {
    await _runAction(() async {
      await _dataSource.retry();
      await _pollUntilSettled();
    });
  }

  Future<void> rebuild() async {
    await _runAction(() async {
      await _dataSource.rebuild();
      await _pollUntilSettled();
    });
  }

  Future<void> _discover({bool notify = true}) async {
    try {
      _candidates = await _dataSource.discover();
    } catch (_) {
      _candidates = const [];
    }
    if (notify) _notify();
  }

  Future<void> _runAction(Future<void> Function() action) async {
    if (_isBusy) return;
    _isBusy = true;
    _actionFailureCategory = null;
    _notify();
    try {
      await action();
    } on SemanticMemoryApiException {
      _actionFailureCategory = 'unavailable';
    } catch (_) {
      _actionFailureCategory = 'unavailable';
    } finally {
      _isBusy = false;
      _notify();
    }
  }

  Future<void> _pollUntilSettled() async {
    final generation = ++_operationGeneration;
    for (var attempt = 0; attempt < _maxPollAttempts; attempt++) {
      await refresh();
      if (generation != _operationGeneration || _disposed) return;
      if (!(_status?.isWorking ?? false)) return;
      await Future<void>.delayed(_pollDelay);
    }
    _actionFailureCategory = 'timeout';
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _operationGeneration++;
    super.dispose();
  }
}
