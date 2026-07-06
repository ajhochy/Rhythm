import 'package:flutter/foundation.dart';
import '../../agents/models/agent_session.dart';
import '../models/agent_scheduled_task.dart';
import '../repositories/agent_schedules_repository.dart';

enum AgentSchedulesStatus { idle, loading, error }

class AgentSchedulesController extends ChangeNotifier {
  AgentSchedulesController(this._repository);

  final AgentSchedulesRepository _repository;

  List<AgentScheduledTask> _tasks = [];
  AgentSchedulesStatus _status = AgentSchedulesStatus.idle;
  String? _error;

  List<AgentScheduledTask> get tasks => _tasks;
  AgentSchedulesStatus get status => _status;
  String? get error => _error;

  AgentScheduledTask? byId(String id) {
    try {
      return _tasks.firstWhere((t) => t.id == id);
    } catch (_) {
      return null;
    }
  }

  Future<void> refresh() async {
    _status = AgentSchedulesStatus.loading;
    _error = null;
    notifyListeners();

    try {
      _tasks = await _repository.list();
      _status = AgentSchedulesStatus.idle;
    } catch (e) {
      _error = e.toString();
      _status = AgentSchedulesStatus.error;
    }
    notifyListeners();
  }

  Future<void> create(Map<String, dynamic> input) async {
    try {
      final created = await _repository.create(input);
      _tasks = [..._tasks, created];
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      rethrow;
    }
  }

  Future<void> update(String id, Map<String, dynamic> patch) async {
    try {
      final updated = await _repository.update(id, patch);
      _tasks = _tasks.map((t) => t.id == id ? updated : t).toList();
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      rethrow;
    }
  }

  Future<void> delete(String id) async {
    try {
      await _repository.delete(id);
      _tasks = _tasks.where((t) => t.id != id).toList();
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      rethrow;
    }
  }

  Future<AgentScheduledTask> triggerNow(String id) async {
    try {
      final updated = await _repository.triggerNow(id);
      _tasks = _tasks.map((t) => t.id == id ? updated : t).toList();
      notifyListeners();
      return updated;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      rethrow;
    }
  }

  /// #904 — recent runs of a scheduled task (activity log). Not cached on the
  /// controller: callers (the detail sheet) own their own load/loading state
  /// via a FutureBuilder, same as any on-demand detail fetch.
  Future<List<AgentSession>> listRuns(String scheduledTaskId) =>
      _repository.listRuns(scheduledTaskId);
}
