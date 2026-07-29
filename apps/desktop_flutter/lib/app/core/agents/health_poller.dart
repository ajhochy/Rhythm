import 'dart:async';

import 'package:flutter/widgets.dart';

/// A reusable utility that periodically calls an async health-check function,
/// pauses while the app is backgrounded, fires a callback only on health-state
/// transitions, and tolerates transient flaps via a consecutive-failure guard.
class HealthPoller with WidgetsBindingObserver {
  HealthPoller({
    required Future<bool> Function() checkFn,
    required void Function(bool isHealthy) onHealthChanged,
    Duration interval = const Duration(seconds: 15),
    int failureThreshold = 2,
  })  : _checkFn = checkFn,
        _onHealthChanged = onHealthChanged,
        _interval = interval,
        _failureThreshold = failureThreshold;

  final Future<bool> Function() _checkFn;
  final void Function(bool isHealthy) _onHealthChanged;
  final Duration _interval;
  final int _failureThreshold;

  Timer? _timer;
  bool _isHealthy = true;
  int _consecutiveFailures = 0;
  bool _disposed = false;

  /// Start polling. Registers as a [WidgetsBindingObserver], runs an immediate
  /// check, then starts a periodic timer.
  void start() {
    if (_disposed) return;
    WidgetsBinding.instance.addObserver(this);
    _runCheck();
    _startTimer();
  }

  /// Cancel the timer and remove the observer. Idempotent.
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _timer?.cancel();
    _timer = null;
    WidgetsBinding.instance.removeObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_disposed) return;
    if (state == AppLifecycleState.resumed) {
      _runCheck();
      _startTimer();
    } else {
      _timer?.cancel();
      _timer = null;
    }
  }

  void _startTimer() {
    _timer?.cancel();
    _timer = Timer.periodic(_interval, (_) => _runCheck());
  }

  void _runCheck() {
    if (_disposed) return;
    _checkFn().then((ok) {
      if (_disposed) return;
      if (ok) {
        _consecutiveFailures = 0;
        if (!_isHealthy) {
          _isHealthy = true;
          _onHealthChanged(true);
        }
      } else {
        _consecutiveFailures++;
        if (_isHealthy && _consecutiveFailures >= _failureThreshold) {
          _isHealthy = false;
          _onHealthChanged(false);
        }
      }
    }).catchError((_) {
      if (_disposed) return;
      _consecutiveFailures++;
      if (_isHealthy && _consecutiveFailures >= _failureThreshold) {
        _isHealthy = false;
        _onHealthChanged(false);
      }
    });
  }
}
