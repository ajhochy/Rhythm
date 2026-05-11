import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../constants/app_constants.dart';
import '../server/api_server_service.dart';
import 'health_poller.dart';

enum AgentServerStatus { starting, ready, failed }

class AgentServerController extends ChangeNotifier {
  AgentServerController(this._service);

  final ApiServerService _service;
  AgentServerStatus _status = AgentServerStatus.starting;
  AgentServerFailureReason? _failureReason;
  String? _stderrTail;
  Map<String, bool> _capabilities = const {};
  HealthPoller? _poller;

  AgentServerStatus get status => _status;
  bool get isReady => _status == AgentServerStatus.ready;
  AgentServerFailureReason? get failureReason => _failureReason;
  String? get stderrTail => _stderrTail;

  String? get errorMessage {
    switch (_failureReason) {
      case AgentServerFailureReason.nodeNotFound:
        return "Couldn't find Node.js on this Mac. Install Node 20 or newer "
            'from nodejs.org and click Retry.';
      case AgentServerFailureReason.bundleNotFound:
        return 'The CLI server bundle is missing from this Rhythm install. '
            'Please reinstall Rhythm from the latest release.';
      case AgentServerFailureReason.spawnThrew:
        return "Couldn't start the CLI server process. See technical details "
            'below.';
      case AgentServerFailureReason.healthCheckTimeout:
        return "The CLI server started but didn't respond in time. See "
            'technical details below.';
      case AgentServerFailureReason.lostConnection:
        return 'The agent server stopped responding. Click Restart to bring it back.';
      case null:
        return null;
    }
  }

  Map<String, bool> get capabilities => _capabilities;

  bool isAgentAvailable(String kind) => _capabilities[kind] == true;
  bool get hasAnyAgent => _capabilities.values.any((v) => v);

  Future<void> initialize() async {
    _status = AgentServerStatus.starting;
    _failureReason = null;
    _stderrTail = null;
    _capabilities = const {};
    notifyListeners();

    final result = await _service.start();
    _status = result.ok ? AgentServerStatus.ready : AgentServerStatus.failed;
    _failureReason = result.reason;
    _stderrTail = result.stderrTail;
    notifyListeners();

    if (result.ok) {
      // Fire-and-forget; failures are non-fatal.
      unawaited(refreshCapabilities());

      _poller = HealthPoller(
        checkFn: () => _service.checkHealth(AppConstants.agentLocalBaseUrl),
        onHealthChanged: _onHealthChanged,
        interval: const Duration(seconds: 15),
      );
      _poller!.start();
    }
  }

  void _onHealthChanged(bool healthy) {
    if (!healthy && _status == AgentServerStatus.ready) {
      _status = AgentServerStatus.failed;
      _failureReason = AgentServerFailureReason.lostConnection;
      notifyListeners();
    } else if (healthy &&
        _status == AgentServerStatus.failed &&
        _failureReason == AgentServerFailureReason.lostConnection) {
      _status = AgentServerStatus.ready;
      _failureReason = null;
      notifyListeners();
    }
  }

  Future<void> refreshCapabilities() async {
    try {
      final response = await http.get(
        Uri.parse('http://localhost:4001/agents/capabilities'),
      );
      if (response.statusCode != 200) {
        stderr.writeln(
          '[AgentServerController] capabilities fetch returned '
          'HTTP ${response.statusCode}; leaving capabilities empty.',
        );
        return;
      }
      final decoded = jsonDecode(response.body);
      if (decoded is! Map<String, dynamic>) {
        stderr.writeln(
          '[AgentServerController] capabilities response was not a JSON object; '
          'leaving capabilities empty.',
        );
        return;
      }
      _capabilities = decoded.map(
        (key, value) => MapEntry(key, value == true),
      );
      notifyListeners();
    } catch (e) {
      stderr.writeln(
        '[AgentServerController] failed to fetch capabilities: $e',
      );
      // _capabilities stays empty; status is unchanged.
    }
  }

  /// Exposed for testing only — drives [_onHealthChanged] directly so tests
  /// can verify status transitions without running a real [HealthPoller] timer.
  @visibleForTesting
  void simulateHealthChange(bool healthy) => _onHealthChanged(healthy);

  Future<void> retry() {
    _poller?.dispose();
    _poller = null;
    return initialize();
  }

  @override
  void dispose() {
    _poller?.dispose();
    _poller = null;
    _service.stop();
    super.dispose();
  }
}
