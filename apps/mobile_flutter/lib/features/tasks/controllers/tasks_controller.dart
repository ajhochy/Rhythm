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

  // Computed getters — all use local device midnight as "today".
  DateTime get _today {
    final now = DateTime.now();
    return DateTime(now.year, now.month, now.day);
  }

  bool _isSameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  List<Task> get overdueTasks {
    final today = _today;
    return _tasks.where((t) {
      if (t.status == TaskStatus.done) return false;
      final due = DateTime.tryParse(t.dueDate ?? '');
      if (due == null) return false;
      final dueDay = DateTime(due.year, due.month, due.day);
      return dueDay.isBefore(today);
    }).toList();
  }

  List<Task> get todayTasks {
    final today = _today;
    return _tasks.where((t) {
      if (t.status == TaskStatus.done) return false;
      final due = DateTime.tryParse(t.dueDate ?? '');
      if (due == null) return false;
      return _isSameDay(due, today);
    }).toList();
  }

  List<Task> get completedTodayTasks {
    final today = _today;
    return _tasks.where((t) {
      if (t.status != TaskStatus.done) return false;
      final updated = DateTime.tryParse(t.updatedAt);
      if (updated == null) return false;
      final updatedDay = DateTime(updated.year, updated.month, updated.day);
      return !updatedDay.isBefore(today);
    }).toList();
  }

  Future<void> load() async {
    _status = TasksStatus.loading;
    _errorMessage = null;
    notifyListeners();
    try {
      _tasks = await _repository.fetchAll();
      _status = TasksStatus.idle;
    } catch (e) {
      _errorMessage = e.toString();
      _status = TasksStatus.error;
    }
    notifyListeners();
  }

  Future<void> refresh() => load();

  Future<Task?> createTask({
    required String title,
    String? notes,
    String? dueDate,
  }) async {
    try {
      final task = await _repository.create(
        title: title,
        notes: notes,
        dueDate: dueDate,
      );
      _tasks = List.of(_tasks)..add(task);
      _errorMessage = null;
      notifyListeners();
      return task;
    } catch (e) {
      _errorMessage = e.toString();
      _status = TasksStatus.error;
      notifyListeners();
      return null;
    }
  }

  Future<void> toggleDone(String taskId) async {
    final index = _tasks.indexWhere((t) => t.id == taskId);
    if (index == -1) return;

    final original = _tasks[index];
    final isDone = original.status == TaskStatus.done;

    // Optimistic update.
    final optimistic = original.copyWith(
      status: isDone ? TaskStatus.open : TaskStatus.done,
    );
    _tasks = List.of(_tasks)..[index] = optimistic;
    _errorMessage = null;
    notifyListeners();

    try {
      final updated = isDone
          ? await _repository.markOpen(taskId)
          : await _repository.markDone(taskId);
      _tasks = List.of(_tasks)..[index] = updated;
      _status = TasksStatus.idle;
    } catch (e) {
      // Revert on failure.
      _tasks = List.of(_tasks)..[index] = original;
      _errorMessage = e.toString();
      _status = TasksStatus.error;
    }
    notifyListeners();
  }
}
