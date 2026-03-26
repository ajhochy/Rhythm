import 'package:flutter/foundation.dart';

import 'app_update_info.dart';
import 'update_service.dart';

class UpdateController extends ChangeNotifier {
  UpdateController(this._service);

  final UpdateService _service;

  bool _isChecking = false;
  String? _currentVersion;
  AppUpdateInfo? _availableUpdate;
  String? _errorMessage;

  bool get isChecking => _isChecking;
  String? get currentVersion => _currentVersion;
  AppUpdateInfo? get availableUpdate => _availableUpdate;
  String? get errorMessage => _errorMessage;

  Future<void> initialize() async {
    _currentVersion ??= await _service.getCurrentVersion();
    notifyListeners();
    await checkForUpdates();
  }

  Future<void> checkForUpdates() async {
    _isChecking = true;
    _errorMessage = null;
    notifyListeners();

    try {
      _currentVersion ??= await _service.getCurrentVersion();
      _availableUpdate = await _service.fetchAvailableUpdate();
    } catch (error) {
      _errorMessage = error.toString();
    } finally {
      _isChecking = false;
      notifyListeners();
    }
  }

  Future<void> openDownload() async {
    final update = _availableUpdate;
    if (update == null) return;
    await _service.openDownload(update);
  }

  Future<void> openReleaseNotes() async {
    final update = _availableUpdate;
    if (update == null) return;
    await _service.openReleaseNotes(update);
  }
}
