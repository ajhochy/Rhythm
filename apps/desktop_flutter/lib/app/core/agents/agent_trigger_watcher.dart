import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../../core/agents/agent_server_controller.dart';
import '../../core/auth/auth_session_service.dart';
import '../../core/services/server_config_service.dart';
import '../../../features/agents/controllers/agents_controller.dart';

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
  void start() {
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
