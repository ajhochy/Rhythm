import 'package:flutter/foundation.dart';

import '../server/api_server_service.dart';

enum AgentServerStatus { starting, ready, failed }

class AgentServerController extends ChangeNotifier {
  AgentServerController(this._service);

  final ApiServerService _service;
  AgentServerStatus _status = AgentServerStatus.starting;
  String? _errorMessage;

  AgentServerStatus get status => _status;
  bool get isReady => _status == AgentServerStatus.ready;
  String? get errorMessage => _errorMessage;

  Future<void> initialize() async {
    _status = AgentServerStatus.starting;
    _errorMessage = null;
    notifyListeners();

    final ok = await _service.start();

    _status = ok ? AgentServerStatus.ready : AgentServerStatus.failed;
    if (!ok) {
      _errorMessage = 'Could not start the local agent server.';
    }
    notifyListeners();
  }

  Future<void> retry() => initialize();

  @override
  void dispose() {
    _service.stop();
    super.dispose();
  }
}
