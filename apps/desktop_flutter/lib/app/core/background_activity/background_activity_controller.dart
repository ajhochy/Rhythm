import 'dart:async';

import 'package:flutter/foundation.dart';

import 'background_status_data_source.dart';
import 'background_status_model.dart';

/// Polls GET /agent-sessions/background-status every [pollInterval] and
/// exposes the result as a [ChangeNotifier]. Stops polling when disposed.
///
/// Follow the established feature-layer pattern: the controller owns the
/// polling timer, the data source owns the HTTP call. No direct HTTP in this file.
class BackgroundActivityController extends ChangeNotifier {
  BackgroundActivityController(
    this._dataSource, {
    Duration pollInterval = const Duration(seconds: 15),
  }) : _pollInterval = pollInterval;

  final BackgroundStatusDataSource _dataSource;
  final Duration _pollInterval;

  Timer? _timer;
  BackgroundStatus? _status;
  bool _disposed = false;

  BackgroundStatus? get status => _status;

  /// True when any background loop is currently active.
  bool get hasActivity => _status?.hasActivity ?? false;

  /// Number of loops actively running.
  int get activeCount => _status?.activeCount ?? 0;

  List<BackgroundLoopStatus> get loops => _status?.loops ?? const [];

  /// Start polling. Safe to call multiple times — subsequent calls are no-ops.
  void startPolling() {
    if (_timer != null || _disposed) return;
    // Fetch once immediately, then on the interval.
    _fetch();
    _timer = Timer.periodic(_pollInterval, (_) => _fetch());
  }

  Future<void> _fetch() async {
    if (_disposed) return;
    try {
      final result = await _dataSource.fetch();
      if (_disposed) return;
      _status = result;
      notifyListeners();
    } catch (_) {
      // Non-fatal: server may not be ready yet. Silently swallow.
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _timer = null;
    super.dispose();
  }
}
