import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../../core/agents/agent_server_controller.dart';
import '../../core/auth/auth_session_service.dart';
import '../../core/services/server_config_service.dart';
import '../../../features/agents/controllers/agents_controller.dart';

/// Returns true when the app is running in a local/dev smoke-test context.
///
/// Checked via:
/// - `--dart-define=RHYTHM_LOCAL_SMOKE=1` (compile-time / `flutter run` flag)
/// - `RHYTHM_LOCAL_SMOKE=1` environment variable at process start
///
/// When true, [AgentTriggerWatcher.start] is a no-op so that no
/// `DELETE /claude-triggers/*` requests are issued against the production
/// server during local smoke runs.
bool get isLocalSmokeRun {
  // dart-define value (available in web, desktop, and mobile).
  const dartDefine = String.fromEnvironment('RHYTHM_LOCAL_SMOKE');
  if (dartDefine == '1') return true;

  // Process-level environment variable (desktop/server only).
  try {
    return Platform.environment['RHYTHM_LOCAL_SMOKE'] == '1';
  } catch (_) {
    // Platform.environment throws on web; fall through.
    return false;
  }
}

/// Polls `GET /claude-triggers` on the production server every [interval]
/// (default 10 s) when the user is authenticated and the local agent server
/// is ready.
///
/// On each successful poll:
/// 1. Hands each trigger to [AgentsController.handleIncomingTrigger].
/// 2. Deletes the trigger from production via `DELETE /claude-triggers/:id`.
///
/// Failures (network errors, 4xx, 5xx) are logged to stderr and silently
/// skipped — the next tick will retry.
///
/// **Local smoke runs:** when [isLocalSmokeRun] is true (i.e.
/// `RHYTHM_LOCAL_SMOKE=1` env var or `--dart-define=RHYTHM_LOCAL_SMOKE=1`),
/// [start] is a no-op. This prevents accidental production traffic during
/// `flutter run` smoke tests.
class AgentTriggerWatcher extends ChangeNotifier {
  AgentTriggerWatcher({
    required ServerConfigService serverConfigService,
    required AuthSessionService authSessionService,
    required AgentServerController agentServerController,
    required AgentsController agentsController,
    Duration interval = const Duration(seconds: 10),
    http.Client? httpClient,
  })  : _serverConfigService = serverConfigService,
        _authSessionService = authSessionService,
        _agentServerController = agentServerController,
        _agentsController = agentsController,
        _interval = interval,
        _httpClient = httpClient ?? http.Client();

  final ServerConfigService _serverConfigService;
  final AuthSessionService _authSessionService;
  final AgentServerController _agentServerController;
  final AgentsController _agentsController;
  final Duration _interval;
  final http.Client _httpClient;

  Timer? _timer;
  bool _isPolling = false;

  /// Whether the polling timer is currently active.
  bool get isPolling => _isPolling;

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /// Starts the periodic polling timer. Safe to call multiple times; an
  /// existing timer is cancelled before the new one is created.
  ///
  /// No-op when [isLocalSmokeRun] is true so that smoke runs never issue
  /// DELETE requests against the production `claude-triggers` endpoint.
  void start() {
    if (isLocalSmokeRun) {
      stderr.writeln(
        '[AgentTriggerWatcher] RHYTHM_LOCAL_SMOKE=1 detected — '
        'watcher is disabled for this run. No production traffic will be issued.',
      );
      return;
    }
    _timer?.cancel();
    _isPolling = true;
    notifyListeners();
    // Fire immediately, then on each tick.
    unawaited(_poll());
    _timer = Timer.periodic(_interval, (_) => unawaited(_poll()));
  }

  /// Cancels the polling timer.
  void stop() {
    _timer?.cancel();
    _timer = null;
    _isPolling = false;
    notifyListeners();
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  Future<void> _poll() async {
    final token = _authSessionService.sessionToken;
    if (token == null) {
      // Not authenticated — skip this tick.
      return;
    }
    if (!_agentServerController.isReady) {
      // Local agent server not ready — no point surfacing a trigger.
      return;
    }

    final baseUrl = _serverConfigService.url;

    try {
      final getResponse = await _httpClient.get(
        Uri.parse('$baseUrl/claude-triggers'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      );

      if (getResponse.statusCode != 200) {
        stderr.writeln(
          '[AgentTriggerWatcher] GET /claude-triggers returned '
          'HTTP ${getResponse.statusCode}; skipping tick.',
        );
        return;
      }

      final decoded = jsonDecode(getResponse.body);
      if (decoded is! List) {
        stderr.writeln(
          '[AgentTriggerWatcher] GET /claude-triggers did not return a JSON '
          'array; skipping tick.',
        );
        return;
      }

      for (final item in decoded) {
        if (item is! Map<String, dynamic>) continue;
        final id = item['id'];
        if (id == null) continue;

        try {
          await _agentsController.handleIncomingTrigger(item);
        } catch (e) {
          stderr.writeln(
            '[AgentTriggerWatcher] handleIncomingTrigger failed for trigger '
            '$id: $e — skipping DELETE.',
          );
          continue;
        }

        // Delete the trigger so it is not re-delivered on the next poll.
        try {
          final deleteResponse = await _httpClient.delete(
            Uri.parse('$baseUrl/claude-triggers/$id'),
            headers: {'Authorization': 'Bearer $token'},
          );
          if (deleteResponse.statusCode != 200 &&
              deleteResponse.statusCode != 204) {
            stderr.writeln(
              '[AgentTriggerWatcher] DELETE /claude-triggers/$id returned '
              'HTTP ${deleteResponse.statusCode}; trigger will be retried.',
            );
          }
        } catch (e) {
          stderr.writeln(
            '[AgentTriggerWatcher] DELETE /claude-triggers/$id failed: $e; '
            'trigger will be retried.',
          );
        }
      }
    } catch (e) {
      stderr.writeln('[AgentTriggerWatcher] poll error: $e');
    }
  }

  // --------------------------------------------------------------------------
  // Dispose
  // --------------------------------------------------------------------------

  @override
  void dispose() {
    stop();
    _httpClient.close();
    super.dispose();
  }
}
