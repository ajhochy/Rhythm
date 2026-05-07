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
  AgentServerFailureReason? _failureReason;
  String? _stderrTail;
  Map<String, bool> _capabilities = const {};

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
