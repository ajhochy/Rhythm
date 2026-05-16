import 'package:flutter/foundation.dart';

import '../models/agent_project.dart';
import '../repositories/agent_projects_repository.dart';

enum AgentProjectsLoadStatus { idle, loading, error }

/// Owns the local list of agent projects and the currently-selected one.
///
/// `selectedProjectId == null` corresponds to the "All sessions" pseudo-project
/// at the top of the sidebar rail (M1-5).
class AgentProjectsController extends ChangeNotifier {
  AgentProjectsController(this._repository);

  final AgentProjectsRepository _repository;

  List<AgentProject> _projects = const [];
  List<AgentProject> get projects => List.unmodifiable(_projects);

  String? _selectedProjectId;
  String? get selectedProjectId => _selectedProjectId;

  AgentProject? get selectedProject {
    final id = _selectedProjectId;
    if (id == null) return null;
    for (final p in _projects) {
      if (p.id == id) return p;
    }
    return null;
  }

  AgentProjectsLoadStatus _status = AgentProjectsLoadStatus.idle;
  AgentProjectsLoadStatus get status => _status;

  String? _error;
  String? get error => _error;

  Future<void> load({bool includeArchived = false}) async {
    _status = AgentProjectsLoadStatus.loading;
    _error = null;
    notifyListeners();
    try {
      _projects = await _repository.list(includeArchived: includeArchived);
      _status = AgentProjectsLoadStatus.idle;
    } catch (e) {
      _error = e.toString();
      _status = AgentProjectsLoadStatus.error;
    }
    notifyListeners();
  }

  Future<AgentProject> create({
    required String name,
    required String cwd,
    String? icon,
  }) async {
    final created = await _repository.create(name: name, cwd: cwd, icon: icon);
    _projects = [created, ..._projects];
    notifyListeners();
    return created;
  }

  Future<AgentProject> update(
    String id, {
    String? name,
    String? cwd,
    String? icon,
    DateTime? archivedAt,
    bool clearArchivedAt = false,
  }) async {
    final updated = await _repository.update(
      id,
      name: name,
      cwd: cwd,
      icon: icon,
      archivedAt: archivedAt,
      clearArchivedAt: clearArchivedAt,
    );
    _replaceById(updated);
    notifyListeners();
    return updated;
  }

  Future<void> archive(String id) async {
    final updated = await _repository.update(id, archivedAt: DateTime.now());
    // archive removes from the visible list (load() filters archived by default).
    _projects = _projects.where((p) => p.id != updated.id).toList();
    if (_selectedProjectId == id) {
      _selectedProjectId = null;
    }
    notifyListeners();
  }

  Future<void> delete(String id) async {
    await _repository.delete(id);
    _projects = _projects.where((p) => p.id != id).toList();
    if (_selectedProjectId == id) {
      _selectedProjectId = null;
    }
    notifyListeners();
  }

  Future<AgentProject> refreshVcs(String id) async {
    final updated = await _repository.refreshVcs(id);
    _replaceById(updated);
    notifyListeners();
    return updated;
  }

  void select(String? id) {
    if (_selectedProjectId == id) return;
    _selectedProjectId = id;
    notifyListeners();
  }

  void _replaceById(AgentProject updated) {
    final idx = _projects.indexWhere((p) => p.id == updated.id);
    if (idx >= 0) {
      final next = List<AgentProject>.from(_projects);
      next[idx] = updated;
      _projects = next;
    }
  }
}
