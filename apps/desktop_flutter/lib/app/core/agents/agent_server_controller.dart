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

  /// Rich failure message surfaced by the service (e.g. ABI rebuild command).
  String? _richFailureMessage;
  Map<String, bool> _capabilities = const {};

  /// OPC-M1-3: provider-id → agent-kind mapping fetched from
  /// GET /agents/capabilities as the `providerToAgentKind` field.
  /// Offline fallback: the hardcoded constants below.
  Map<String, String> _providerToAgentKind = const {
    'anthropic': 'claude-code',
    'github-copilot': 'claude-code',
    'openai': 'codex',
    'google': 'gemini-cli',
  };

  HealthPoller? _poller;

  AgentServerStatus get status => _status;
  bool get isReady => _status == AgentServerStatus.ready;
  AgentServerFailureReason? get failureReason => _failureReason;
  String? get stderrTail => _stderrTail;

  String? get errorMessage {
    // If a rich failure message was surfaced (e.g. ABI rebuild command), use it.
    if (_richFailureMessage != null) return _richFailureMessage;
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

  /// OPC-M1-3: provider-id → agent-kind map. Fetched from capabilities
  /// endpoint; falls back to the compile-time defaults when offline.
  Map<String, String> get providerToAgentKind => _providerToAgentKind;

  bool isAgentAvailable(String kind) => _capabilities[kind] == true;
  bool get hasAnyAgent => _capabilities.values.any((v) => v);

  Future<void> initialize() async {
    _status = AgentServerStatus.starting;
    _failureReason = null;
    _stderrTail = null;
    _richFailureMessage = null;
    _capabilities = const {};
    _providerToAgentKind = const {
      'anthropic': 'claude-code',
      'github-copilot': 'claude-code',
      'openai': 'codex',
      'google': 'gemini-cli',
    };
    notifyListeners();

    final result = await _service.start();
    _status = result.ok ? AgentServerStatus.ready : AgentServerStatus.failed;
    _failureReason = result.reason;
    _stderrTail = result.stderrTail;
    _richFailureMessage = result.failureMessage;
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
      // OPC-M1-3: The capabilities response now contains two kinds of values:
      //   - boolean flags  (e.g. { 'claude-code': true, 'codex': false })
      //   - providerToAgentKind: { 'anthropic': 'claude-code', ... }
      // Extract each separately; casting all values to bool would lose the map.
      final boolCaps = <String, bool>{};
      Map<String, String>? newProviderMap;
      for (final entry in decoded.entries) {
        if (entry.key == 'providerToAgentKind') {
          final raw = entry.value;
          if (raw is Map) {
            newProviderMap =
                raw.map((k, v) => MapEntry(k.toString(), v.toString()));
          }
        } else {
          boolCaps[entry.key] = entry.value == true;
        }
      }
      _capabilities = boolCaps;
      if (newProviderMap != null && newProviderMap.isNotEmpty) {
        _providerToAgentKind = newProviderMap;
      }
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

  /// Gracefully stop the server and clean up. Returns a Future that completes
  /// once the process has exited (or been force-killed after 2 s).
  Future<void> stopAndDispose() async {
    _poller?.dispose();
    _poller = null;
    await _service.stopGracefully();
  }

  @override
  void dispose() {
    _poller?.dispose();
    _poller = null;
    _service.stop();
    super.dispose();
  }
}
