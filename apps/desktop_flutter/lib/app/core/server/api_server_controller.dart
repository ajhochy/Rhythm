import 'package:flutter/foundation.dart';

import 'api_server_service.dart';

enum ServerStatus { starting, ready, failed }

class ApiServerController extends ChangeNotifier {
  ApiServerController(this._service);

  final ApiServerService _service;
  static const useEmbeddedServer = bool.fromEnvironment(
    'RHYTHM_USE_EMBEDDED_API',
    defaultValue: true,
  );
  ServerStatus _status = ServerStatus.starting;

  ServerStatus get status => _status;
  bool get isReady => _status == ServerStatus.ready;

  Future<void> initialize() async {
    if (!useEmbeddedServer) {
      _status = ServerStatus.ready;
      notifyListeners();
      return;
    }

    _status = ServerStatus.starting;
    notifyListeners();

    final ok = await _service.start();

    _status = ok ? ServerStatus.ready : ServerStatus.failed;
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
