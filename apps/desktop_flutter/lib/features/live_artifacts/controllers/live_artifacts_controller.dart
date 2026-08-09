import 'package:flutter/foundation.dart';

import '../../settings/data/user_preferences_data_source.dart';
import '../data/live_artifacts_data_source.dart';
import '../models/live_artifact.dart';

class LiveArtifactsController extends ChangeNotifier {
  LiveArtifactsController(this._artifacts, this._preferences);

  final LiveArtifactsDataSource _artifacts;
  final UserPreferencesDataSource _preferences;
  final List<LiveArtifactTab> _tabs = [];
  List<LiveArtifact> _available = [];
  String? _selectedId;
  int? _userId;
  int _restoreGeneration = 0;
  int _saveGeneration = 0;
  int _nextRequestToken = 0;
  int _pickerRequestToken = 0;
  final Map<String, int> _tabTokens = {};
  Future<void> _saveTail = Future.value();
  String? pickerError;
  String? persistenceError;

  List<LiveArtifactTab> get tabs => List.unmodifiable(_tabs);
  List<LiveArtifact> get available => List.unmodifiable(_available);
  String? get selectedId => _selectedId;
  bool get dashboardSelected => _selectedId == null;

  /// Clears identity-bound data synchronously before a different auth frame.
  void reset() {
    _restoreGeneration++;
    _saveGeneration++;
    _userId = null;
    _selectedId = null;
    _tabs.clear();
    _available = [];
    _tabTokens.clear();
    pickerError = null;
    persistenceError = null;
    notifyListeners();
  }

  @visibleForTesting
  void debugSetForTest({
    List<LiveArtifactTab>? tabs,
    List<LiveArtifact>? available,
    String? error,
  }) {
    if (tabs != null) {
      _tabs
        ..clear()
        ..addAll(tabs);
      _tabTokens
        ..clear()
        ..addEntries(tabs.map((tab) => MapEntry(tab.id, ++_nextRequestToken)));
    }
    if (available != null) _available = available;
    pickerError = error;
    notifyListeners();
  }

  Future<void> restore(int userId, List<String> ids) async {
    if (_userId == userId) return;
    final generation = ++_restoreGeneration;
    ++_saveGeneration;
    _userId = userId;
    _selectedId = null; // AV-04 restores tabs but always opens Dashboard.
    _tabs
      ..clear()
      ..addAll(ids.map(_loadingTab));
    _tabTokens.clear();
    for (final tab in _tabs) {
      _tabTokens[tab.id] = ++_nextRequestToken;
    }
    notifyListeners();
    try {
      final available = await _artifacts.list();
      if (_userId != userId || _restoreGeneration != generation) return;
      _available = available;
      pickerError = null;
    } catch (_) {
      if (_userId != userId || _restoreGeneration != generation) return;
      pickerError = 'Could not load live artifacts. Try again.';
    }
    await Future.wait(
        List.of(_tabs).map((tab) => _loadTab(tab.id, userId, generation)));
    if (_userId != userId || _restoreGeneration != generation) return;
    notifyListeners();
  }

  Future<void> retryPicker() async {
    final userId = _userId;
    if (userId == null) return;
    final generation = _restoreGeneration;
    final requestToken = ++_nextRequestToken;
    _pickerRequestToken = requestToken;
    try {
      final available = await _artifacts.list();
      if (!_pickerRequestIsCurrent(userId, generation, requestToken)) return;
      _available = available;
      pickerError = null;
    } catch (_) {
      if (!_pickerRequestIsCurrent(userId, generation, requestToken)) return;
      pickerError = 'Could not load live artifacts. Try again.';
    }
    notifyListeners();
  }

  Future<void> open(LiveArtifact artifact) async {
    if (_tabs.any((tab) => tab.id == artifact.id)) {
      select(artifact.id);
      return;
    }
    _tabs.add(LiveArtifactTab(
        id: artifact.id,
        status: LiveArtifactTabStatus.ready,
        artifact: artifact));
    _tabTokens[artifact.id] = ++_nextRequestToken;
    _selectedId = artifact.id;
    notifyListeners();
    _persist();
  }

  void select(String? id) {
    _selectedId = id;
    notifyListeners();
  }

  Future<void> close(String id) async {
    final index = _tabs.indexWhere((tab) => tab.id == id);
    if (index < 0) return;
    _tabs.removeAt(index);
    _tabTokens.remove(id);
    if (_selectedId == id) _selectedId = index > 0 ? _tabs[index - 1].id : null;
    notifyListeners();
    _persist();
  }

  Future<void> retryTab(String id) async {
    final userId = _userId;
    if (userId == null) return;
    final index = _tabs.indexWhere((tab) => tab.id == id);
    if (index < 0) return;
    _tabs[index] = _loadingTab(id);
    notifyListeners();
    await _loadTab(id, userId, _restoreGeneration);
    notifyListeners();
  }

  Future<void> _loadTab(String id, int userId, int generation) async {
    final requestToken = ++_nextRequestToken;
    _tabTokens[id] = requestToken;
    try {
      final artifact = await _artifacts.get(id);
      final index = _currentIndex(id, userId, generation, requestToken);
      if (index < 0) return;
      _tabs[index] = LiveArtifactTab(
          id: id, status: LiveArtifactTabStatus.ready, artifact: artifact);
    } catch (error) {
      final index = _currentIndex(id, userId, generation, requestToken);
      if (index < 0) return;
      final text = error.toString();
      final status = text.contains('410')
          ? LiveArtifactTabStatus.deleted
          : text.contains('403') || text.contains('404')
              ? LiveArtifactTabStatus.unavailable
              : text.contains('409')
                  ? LiveArtifactTabStatus.conflict
                  : LiveArtifactTabStatus.error;
      _tabs[index] = LiveArtifactTab(
          id: id,
          status: status,
          message: status == LiveArtifactTabStatus.deleted
              ? 'This artifact was deleted.'
              : status == LiveArtifactTabStatus.unavailable
                  ? 'This artifact is unavailable.'
                  : status == LiveArtifactTabStatus.conflict
                      ? 'This artifact changed elsewhere. Refresh and try again.'
                      : 'Could not load this artifact.');
    }
  }

  LiveArtifactTab _loadingTab(String id) =>
      LiveArtifactTab(id: id, status: LiveArtifactTabStatus.loading);

  int _currentIndex(String id, int userId, int generation, int requestToken) =>
      _userId == userId &&
              _restoreGeneration == generation &&
              _tabTokens[id] == requestToken
          ? _tabs.indexWhere((tab) => tab.id == id)
          : -1;

  bool _pickerRequestIsCurrent(int userId, int generation, int requestToken) =>
      _userId == userId &&
      _restoreGeneration == generation &&
      _pickerRequestToken == requestToken;

  void _persist() {
    final userId = _userId;
    if (userId == null) return;
    final generation = _saveGeneration;
    final ids = _tabs.map((tab) => tab.id).toList(growable: false);
    _saveTail = _saveTail.catchError((_) {}).then((_) async {
      if (_userId != userId || _saveGeneration != generation) return;
      try {
        await _preferences.updateArtifactTabIds(ids);
        if (_userId == userId && _saveGeneration == generation) {
          persistenceError = null;
          notifyListeners();
        }
      } catch (_) {
        if (_userId == userId && _saveGeneration == generation) {
          persistenceError = 'Could not save live artifact tabs.';
          notifyListeners();
        }
      }
    });
  }
}
