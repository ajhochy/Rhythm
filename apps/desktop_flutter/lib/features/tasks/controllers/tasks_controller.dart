import 'package:flutter/foundation.dart';
import '../models/task.dart';
import '../repositories/tasks_repository.dart';

enum TasksStatus { idle, loading, error }

class TasksController extends ChangeNotifier {
  TasksController(this._repository);

  final TasksRepository _repository;

  List<Task> _tasks = [];
  TasksStatus _status = TasksStatus.idle;
  String? _errorMessage;

  List<Task> get tasks => _tasks;
  TasksStatus get status => _status;
  String? get errorMessage => _errorMessage;

  Future<void> load() async {
    _status = TasksStatus.loading;
    _errorMessage = null;
    notifyListeners();
    try {
      _tasks = await _repository.getAll();
      _status = TasksStatus.idle;
    } catch (e) {
      _errorMessage = e.toString();
      _status = TasksStatus.error;
    }
    notifyListeners();
  }

  Future<void> createTask(
    String title, {
    String? notes,
    String? dueDate,
    int? collaboratorId,
  }) async {
    try {
      final task = await _repository.create(
        title,
        notes: notes,
        dueDate: dueDate,
        collaboratorId: collaboratorId,
      );
      _tasks = [..._tasks, task];
      _status = TasksStatus.idle;
      _errorMessage = null;
      notifyListeners();
    } catch (e) {
      _errorMessage = e.toString();
      _status = TasksStatus.error;
      notifyListeners();
    }
  }

  Future<void> updateTask(
    String id, {
    String? title,
    String? notes,
    String? dueDate,
    String? scheduledDate,
    bool includeNotes = false,
    bool includeDueDate = false,
    bool includeScheduledDate = false,
  }) async {
    try {
      final updated = await _repository.update(
        id,
        title: title,
        notes: notes,
        dueDate: dueDate,
        scheduledDate: scheduledDate,
        includeNotes: includeNotes,
        includeDueDate: includeDueDate,
        includeScheduledDate: includeScheduledDate,
      );
      _tasks = _tasks
          .map(
            (t) => t.id == id
                ? updated.copyWith(collaborators: t.collaborators)
                : t,
          )
          .toList();
      _status = TasksStatus.idle;
      _errorMessage = null;
      notifyListeners();
    } catch (e) {
      _errorMessage = e.toString();
      _status = TasksStatus.error;
      notifyListeners();
    }
  }

  Future<void> toggleDone(String id) async {
    final task = _tasks.firstWhere((t) => t.id == id);
    final newStatus = task.status == 'done' ? 'open' : 'done';
    try {
      final updated = await _repository.update(id, status: newStatus);
      _tasks = _tasks.map((t) => t.id == id ? updated : t).toList();
      _status = TasksStatus.idle;
      _errorMessage = null;
      notifyListeners();
    } catch (e) {
      _errorMessage = e.toString();
      _status = TasksStatus.error;
      notifyListeners();
    }
  }

  Future<void> deleteTask(String id) async {
    try {
      await _repository.delete(id);
      _tasks = _tasks.where((t) => t.id != id).toList();
      _status = TasksStatus.idle;
      _errorMessage = null;
      notifyListeners();
    } catch (e) {
      _errorMessage = e.toString();
      _status = TasksStatus.error;
      notifyListeners();
    }
  }
}
