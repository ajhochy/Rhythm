import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../server/api_server_service.dart';

enum AgentServerStatus { starting, ready, failed }

class AgentServerController extends ChangeNotifier {
  AgentServerController(this._service);

  final ApiServerService _service;
  AgentServerStatus _status = AgentServerStatus.starting;
  String? _errorMessage;
  Map<String, bool> _capabilities = const {};

  AgentServerStatus get status => _status;
  bool get isReady => _status == AgentServerStatus.ready;
  String? get errorMessage => _errorMessage;
  Map<String, bool> get capabilities => _capabilities;

  bool isAgentAvailable(String kind) => _capabilities[kind] == true;
  bool get hasAnyAgent => _capabilities.values.any((v) => v);

  Future<void> initialize() async {
    _status = AgentServerStatus.starting;
    _errorMessage = null;
    _capabilities = const {};
    notifyListeners();

    final result = await _service.start();
    final ok = result.ok;

    _status = ok ? AgentServerStatus.ready : AgentServerStatus.failed;
    if (!ok) {
      _errorMessage = 'Could not start the local agent server.';
    }
    notifyListeners();

    if (ok) {
      // Fire-and-forget; failures are non-fatal.
      unawaited(refreshCapabilities());
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

  Future<void> retry() => initialize();

  @override
  void dispose() {
    _service.stop();
    super.dispose();
  }
}
