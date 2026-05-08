import 'package:flutter/foundation.dart';

import '../models/agent_config.dart';
import '../repositories/agent_configs_repository.dart';

enum AgentConfigsStatus { idle, loading, error }

class AgentConfigsController extends ChangeNotifier {
  AgentConfigsController(this._repository);

  final AgentConfigsRepository _repository;

  List<AgentConfig> _configs = [];
  AgentConfigsStatus _status = AgentConfigsStatus.idle;
  String? _error;

  List<AgentConfig> get configs => List.unmodifiable(_configs);

  AgentConfigsStatus get status => _status;

  String? get error => _error;

  /// All configs that are enabled agents, ordered by [AgentConfig.sortOrder].
  List<AgentConfig> get enabledAgents =>
      _configs.where((c) => c.enabled && c.isAgent).toList()
        ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));

  /// Look up a config by its id. Returns null if not found.
  AgentConfig? byId(String id) {
    for (final c in _configs) {
      if (c.id == id) return c;
    }
    return null;
  }

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  Future<void> refresh() async {
    _status = AgentConfigsStatus.loading;
    _error = null;
    notifyListeners();
    try {
      _configs = await _repository.getAll();
      _status = AgentConfigsStatus.idle;
    } catch (e) {
      _error = e.toString();
      _status = AgentConfigsStatus.error;
    }
    notifyListeners();
  }

  Future<AgentConfig?> create(Map<String, dynamic> input) async {
    try {
      final config = await _repository.create(input);
      _configs = [..._configs, config];
      _error = null;
      notifyListeners();
      return config;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return null;
    }
  }

  Future<bool> update(String id, Map<String, dynamic> patch) async {
    try {
      final updated = await _repository.update(id, patch);
      _configs = _configs.map((c) => c.id == id ? updated : c).toList();
      _error = null;
      notifyListeners();
      return true;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return false;
    }
  }

  Future<bool> delete(String id) async {
    try {
      await _repository.delete(id);
      _configs = _configs.where((c) => c.id != id).toList();
      _error = null;
      notifyListeners();
      return true;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return false;
    }
  }
}
