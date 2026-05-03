import 'package:flutter/foundation.dart';

import 'api_server_service.dart';

enum ServerStatus { starting, ready, failed }

class ApiServerController extends ChangeNotifier {
  ApiServerController(this._service, {required this.serverUrl});

  final ApiServerService _service;
  final String serverUrl;
  static const useEmbeddedServer = bool.fromEnvironment(
    'RHYTHM_USE_EMBEDDED_API',
    defaultValue: false,
  );
  ServerStatus _status = ServerStatus.starting;
  String? _errorMessage;

  ServerStatus get status => _status;
  bool get isReady => _status == ServerStatus.ready;
  String? get errorMessage => _errorMessage;

  Future<void> initialize() async {
    _status = ServerStatus.starting;
    _errorMessage = null;
    notifyListeners();

    if (!useEmbeddedServer) {
      final ok = await _service.checkHealth(serverUrl);
      _status = ok ? ServerStatus.ready : ServerStatus.failed;
      if (!ok) {
        _errorMessage =
            'Could not reach the Rhythm server at $serverUrl. Check the hosted API URL and try again.';
      }
      notifyListeners();
      return;
    }

    final ok = await _service.start();

    _status = ok ? ServerStatus.ready : ServerStatus.failed;
    if (!ok) {
      _errorMessage = 'Could not start the embedded Rhythm server.';
    }
    notifyListeners();
  }

  Future<void> retry() => initialize();

  @override
  void dispose() {
    if (useEmbeddedServer) {
      _service.stop();
    }
    super.dispose();
  }
}
