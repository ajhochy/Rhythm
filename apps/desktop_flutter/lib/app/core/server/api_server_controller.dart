import 'package:flutter/foundation.dart';

import 'api_server_service.dart';

enum ServerStatus { starting, ready, failed }

class ApiServerController extends ChangeNotifier {
  ApiServerController(this._service);

  final ApiServerService _service;
  ServerStatus _status = ServerStatus.starting;

  ServerStatus get status => _status;
  bool get isReady => _status == ServerStatus.ready;

  Future<void> initialize() async {
    _status = ServerStatus.starting;
    notifyListeners();

    final ok = await _service.start();

    _status = ok ? ServerStatus.ready : ServerStatus.failed;
    notifyListeners();
  }

  Future<void> retry() => initialize();

  @override
  void dispose() {
    _service.stop();
    super.dispose();
  }
}
