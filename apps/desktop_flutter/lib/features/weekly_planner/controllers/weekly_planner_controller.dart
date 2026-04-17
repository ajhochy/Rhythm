import 'package:flutter/foundation.dart';
import '../../tasks/models/task.dart';
import '../../tasks/repositories/tasks_repository.dart';
import '../models/weekly_plan.dart';
import '../repositories/weekly_plan_repository.dart';

enum WeeklyPlannerStatus { idle, loading, error }

class WeeklyPlannerController extends ChangeNotifier {
  WeeklyPlannerController(this._repository, this._tasksRepository)
      : _currentWeekLabel = _todayWeekLabel();

  final WeeklyPlanRepository _repository;
  final TasksRepository _tasksRepository;

  WeeklyPlan? _plan;
  WeeklyPlannerStatus _status = WeeklyPlannerStatus.idle;
  String? _errorMessage;
  String _currentWeekLabel;
  String? _selectedTaskId;
  final Set<String> _selectedTaskIds = {};

  WeeklyPlan? get plan => _plan;
  WeeklyPlannerStatus get status => _status;
  String? get errorMessage => _errorMessage;
  String get currentWeekLabel => _currentWeekLabel;
  String? get selectedTaskId => _selectedTaskId;
  Set<String> get selectedTaskIds => Set.unmodifiable(_selectedTaskIds);

  bool get isCurrentWeek => _currentWeekLabel == _todayWeekLabel();

  Future<void> load() async {
    _status = WeeklyPlannerStatus.loading;
    _errorMessage = null;
    notifyListeners();
    try {
      _plan = await _repository.fetchPlan(_currentWeekLabel);
      _status = WeeklyPlannerStatus.idle;
    } catch (e) {
      _errorMessage = e.toString();
      _status = WeeklyPlannerStatus.error;
    }
    notifyListeners();
  }

  void goToPrevWeek() {
    _currentWeekLabel = _offsetWeek(_currentWeekLabel, -1);
    load();
  }

  void goToNextWeek() {
    _currentWeekLabel = _offsetWeek(_currentWeekLabel, 1);
    load();
  }

  void goToToday() {
    _currentWeekLabel = _todayWeekLabel();
    load();
  }

  void selectTask(String? id) {
    _selectedTaskId = id;
    notifyListeners();
  }

  void toggleTaskSelection(String taskId) {
    if (_selectedTaskIds.contains(taskId)) {
      _selectedTaskIds.remove(taskId);
    } else {
      _selectedTaskIds.add(taskId);
    }
    notifyListeners();
  }

  void clearTaskSelection() {
    if (_selectedTaskIds.isEmpty) return;
    _selectedTaskIds.clear();
    notifyListeners();
  }

  Future<void> scheduleTask(Task task, String date) async {
    try {
      final scheduledOrder = _defaultScheduledOrderForDate(date);
      if (task.sourceType == 'project_step') {
        await _repository.updateTask(
          task.id,
          dueDate: date,
          sourceType: task.sourceType,
        );
      } else if (task.dueDate == null && task.scheduledDate == null) {
        await _repository.updateTask(
          task.id,
          dueDate: date,
          scheduledDate: date,
          scheduledOrder: scheduledOrder,
          sourceType: task.sourceType,
        );
      } else {
        await _repository.scheduleTask(
          task.id,
          date,
          scheduledOrder: scheduledOrder,
        );
      }
      await load();
    } catch (e) {
      _errorMessage = e.toString();
      _status = WeeklyPlannerStatus.error;
      notifyListeners();
    }
  }

  Future<void> toggleTaskDone(Task task, bool currentlyDone) async {
    try {
      await _repository.updateTask(
        task.id,
        status: currentlyDone ? 'open' : 'done',
        sourceType: task.sourceType,
      );
      await load();
    } catch (e) {
      _errorMessage = e.toString();
      _status = WeeklyPlannerStatus.error;
      notifyListeners();
    }
  }

  Future<void> updateTask(
    Task task, {
    String? notes,
    String? dueDate,
    String? scheduledDate,
    int? scheduledOrder,
    int? ownerId,
    bool ownerChanged = false,
  }) async {
    try {
      await _repository.updateTask(
        task.id,
        notes: notes,
        dueDate: dueDate,
        scheduledDate: scheduledDate,
        scheduledOrder: scheduledOrder,
        sourceType: task.sourceType,
      );
      if (ownerChanged) {
        await _tasksRepository.update(
          task.id,
          ownerId: ownerId,
          includeOwnerId: true,
        );
      }
      await load();
    } catch (e) {
      _errorMessage = e.toString();
      _status = WeeklyPlannerStatus.error;
      notifyListeners();
    }
  }

  Future<void> bulkToggleSelectedTasks(
    List<Task> tasks,
    String targetStatus,
  ) async {
    try {
      final selected = tasks.where(
        (task) => _selectedTaskIds.contains(task.id),
      );
      for (final task in selected) {
        await _repository.updateTask(
          task.id,
          status: targetStatus,
          sourceType: task.sourceType,
        );
      }
      _selectedTaskIds.clear();
      await load();
    } catch (e) {
      _errorMessage = e.toString();
      _status = WeeklyPlannerStatus.error;
      notifyListeners();
    }
  }

  Future<void> createTask(String title, {String? dueDate, int? ownerId}) async {
    try {
      await _tasksRepository.create(title, dueDate: dueDate, ownerId: ownerId);
      await load();
    } catch (e) {
      _errorMessage = e.toString();
      _status = WeeklyPlannerStatus.error;
      notifyListeners();
    }
  }

  Future<void> moveTaskEarlier(Task task) async {
    await _repositionTask(task, earlier: true);
  }

  Future<void> moveTaskLater(Task task) async {
    await _repositionTask(task, earlier: false);
  }

  Future<void> _repositionTask(Task task, {required bool earlier}) async {
    if (task.sourceType == 'calendar_shadow_event') return;
    final date = task.scheduledDate ?? task.dueDate;
    final plan = _plan;
    if (date == null || plan == null) return;
    final sameDay = [...plan.tasksForDate(date)]..sort(_compareVisualOrder);
    final currentIndex = sameDay.indexWhere((item) => item.id == task.id);
    if (currentIndex == -1) return;
    final targetIndex = earlier ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= sameDay.length) return;

    final target = sameDay[targetIndex];
    final beforeAnchorIndex = earlier ? targetIndex - 1 : targetIndex;
    final afterAnchorIndex = earlier ? targetIndex : targetIndex + 1;

    final beforeOrder = beforeAnchorIndex >= 0
        ? _visualOrderForTask(sameDay[beforeAnchorIndex])
        : _visualOrderForTask(target) - 10000;
    final afterOrder = afterAnchorIndex < sameDay.length
        ? _visualOrderForTask(sameDay[afterAnchorIndex])
        : _visualOrderForTask(target) + 10000;

    final nextOrder = ((beforeOrder + afterOrder) / 2).round();

    await updateTask(task, scheduledOrder: nextOrder);
  }

  int _defaultScheduledOrderForDate(String date) {
    final dayTasks = [...?_plan?.tasksForDate(date)];
    if (dayTasks.isEmpty) return 10000000;
    final maxOrder = dayTasks
        .map(_visualOrderForTask)
        .reduce((value, element) => value > element ? value : element);
    return maxOrder + 10000;
  }

  static int _compareVisualOrder(Task a, Task b) {
    final compare = _visualOrderForTask(a).compareTo(_visualOrderForTask(b));
    if (compare != 0) return compare;
    return a.title.toLowerCase().compareTo(b.title.toLowerCase());
  }

  static int _visualOrderForTask(Task task) {
    if (task.sourceType == 'calendar_shadow_event' && task.startsAt != null) {
      final dateTime = DateTime.tryParse(task.startsAt!);
      if (dateTime != null) {
        return ((dateTime.hour * 60) + dateTime.minute) * 10000;
      }
    }
    return task.scheduledOrder ?? 10000000;
  }

  // ── ISO week helpers ──────────────────────────────────────────────────────

  /// Find Thursday of the ISO week containing [date].
  /// In Dart weekday: 1=Mon … 7=Sun. ISO Thursday = weekday 4.
  /// Go to Monday of the week (subtract weekday-1 days), then add 3.
  static DateTime _isoThursday(DateTime date) {
    final monday = date.subtract(Duration(days: date.weekday - 1));
    return monday.add(const Duration(days: 3));
  }

  static String _isoWeekLabelFromThursday(DateTime thursday) {
    final jan4 = DateTime.utc(thursday.year, 1, 4);
    final mondayJan4 = jan4.subtract(Duration(days: jan4.weekday - 1));
    final weekNum = ((thursday.difference(mondayJan4).inDays) ~/ 7) + 1;
    return '${thursday.year}-W${weekNum.toString().padLeft(2, '0')}';
  }

  static String _todayWeekLabel() {
    final now = DateTime.now().toUtc();
    final d = DateTime.utc(now.year, now.month, now.day);
    return _isoWeekLabelFromThursday(_isoThursday(d));
  }

  static String _offsetWeek(String label, int delta) {
    final m = RegExp(r'^(\d{4})-W(\d{1,2})$').firstMatch(label);
    if (m == null) return label;
    final year = int.parse(m.group(1)!);
    final week = int.parse(m.group(2)!);
    // Reconstruct Monday of the parsed week, shift by delta weeks
    final jan4 = DateTime.utc(year, 1, 4);
    final mondayWeek1 = jan4.subtract(Duration(days: jan4.weekday - 1));
    final monday = mondayWeek1.add(Duration(days: (week - 1) * 7));
    final shifted = monday.add(Duration(days: delta * 7));
    return _isoWeekLabelFromThursday(_isoThursday(shifted));
  }
}
