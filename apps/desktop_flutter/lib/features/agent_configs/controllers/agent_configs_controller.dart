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

  /// Profiles that should appear in the session composer's agent picker:
  /// enabled, session-selectable, and backed by an opencode agent (ocAgent set,
  /// so they can actually drive a turn). Ordered by sortOrder then label.
  List<AgentConfig> get sessionSelectableAgents =>
      _configs
          .where(
            (c) =>
                c.enabled &&
                c.sessionSelectable &&
                (c.ocAgent ?? '').isNotEmpty,
          )
          .toList()
        ..sort((a, b) {
          final s = a.sortOrder.compareTo(b.sortOrder);
          return s != 0 ? s : a.label.compareTo(b.label);
        });

  /// The manager agent (is_manager = true). Returns null if none set.
  ///
  /// NOTE: the data model assumes exactly one manager, but real installs also
  /// carry the dev `workflow-orchestrator` profile (also is_manager) synced
  /// into the catalog. This returns the FIRST match and is therefore ambiguous
  /// — callers that specifically need Secretary must use [secretaryAgent].
  AgentConfig? get managerAgent {
    for (final c in _configs) {
      if (c.isManager) return c;
    }
    return null;
  }

  /// The Secretary manager profile specifically, resolved by its stable slug
  /// (`secretary`) rather than by "the first manager". Quick actions and
  /// delegation must target Secretary even when other manager profiles (e.g.
  /// the dev `workflow-orchestrator`) are present in the catalog (#888).
  AgentConfig? get secretaryAgent {
    for (final c in _configs) {
      if (c.ocAgent == _secretarySlug || c.id == _secretarySlug) return c;
    }
    return null;
  }

  static const String _secretarySlug = 'secretary';

  /// All specialist configs (enabled + isAgent + not manager), sorted by sortOrder.
  List<AgentConfig> get specialistAgents =>
      _configs.where((c) => c.enabled && c.isAgent && !c.isManager).toList()
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
