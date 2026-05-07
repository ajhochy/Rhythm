import 'package:flutter/foundation.dart';

import 'api_server_service.dart';

enum ServerStatus { starting, ready, failed }

class ApiServerController extends ChangeNotifier {
  ApiServerController(this._service, {required this.serverUrl});

  final ApiServerService _service;
  final String serverUrl;
  ServerStatus _status = ServerStatus.starting;
  String? _errorMessage;

  ServerStatus get status => _status;
  bool get isReady => _status == ServerStatus.ready;
  String? get errorMessage => _errorMessage;

  Future<void> initialize() async {
    _status = ServerStatus.starting;
    _errorMessage = null;
    notifyListeners();

    final ok = await _service.checkHealth(serverUrl);
    _status = ok ? ServerStatus.ready : ServerStatus.failed;
    if (!ok) {
      _errorMessage =
          'Could not reach the Rhythm server at $serverUrl. Check the hosted API URL and try again.';
    }
    notifyListeners();
  }

  Future<void> retry() => initialize();

  @override
  void dispose() {
    super.dispose();
  }
}
