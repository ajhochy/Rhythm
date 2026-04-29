import 'package:flutter/foundation.dart';

import '../../tasks/models/task.dart';
import '../models/dashboard_overview_models.dart';
import '../repositories/dashboard_repository.dart';

enum DashboardStatus { loading, ready, error }

class DashboardController extends ChangeNotifier {
  DashboardController(this._repository);

  final DashboardRepository _repository;

  DashboardStatus _status = DashboardStatus.loading;
  String? _errorMessage;

  int _openTaskCount = 0;
  int _dueThisWeekCount = 0;
  int _activeRhythmsCount = 0;
  int _activeProjectsCount = 0;
  int _messageThreadCount = 0;
  int _pastDueTaskCount = 0;
  int _todayTasksTotalCount = 0;
  int _todayTasksRemainingCount = 0;
  int _thisWeekTasksTotalCount = 0;
  int _thisWeekTasksRemainingCount = 0;
  int _unscheduledTaskCount = 0;
  List<Task> _recentTasks = [];
  List<Task> _pastDueTasks = [];
  List<Task> _thisWeekTasks = [];
  List<Task> _todayTasks = [];
  List<Task> _unscheduledTasks = [];
  List<DashboardRhythmProgress> _activeRhythms = [];
  List<DashboardProjectProgress> _activeProjects = [];
  List<DashboardUnreadMessagePreview> _unreadMessages = [];

  DashboardStatus get status => _status;
  String? get errorMessage => _errorMessage;
  int get openTaskCount => _openTaskCount;
  int get dueThisWeekCount => _dueThisWeekCount;
  int get activeRhythmsCount => _activeRhythmsCount;
  int get activeProjectsCount => _activeProjectsCount;
  int get messageThreadCount => _messageThreadCount;
  int get pastDueTaskCount => _pastDueTaskCount;
  int get todayTasksTotalCount => _todayTasksTotalCount;
  int get todayTasksRemainingCount => _todayTasksRemainingCount;
  int get thisWeekTasksTotalCount => _thisWeekTasksTotalCount;
  int get thisWeekTasksRemainingCount => _thisWeekTasksRemainingCount;
  int get unscheduledTaskCount => _unscheduledTaskCount;
  List<Task> get recentTasks => _recentTasks;
  List<Task> get pastDueTasks => _pastDueTasks;
  List<Task> get thisWeekTasks => _thisWeekTasks;
  List<Task> get todayTasks => _todayTasks;
  List<Task> get unscheduledTasks => _unscheduledTasks;
  List<DashboardRhythmProgress> get activeRhythms => _activeRhythms;
  List<DashboardProjectProgress> get activeProjects => _activeProjects;
  List<DashboardUnreadMessagePreview> get unreadMessages => _unreadMessages;
  DashboardProjectProgress? get soonestProject =>
      _activeProjects.isEmpty ? null : _activeProjects.first;

  Future<void> load() async {
    _status = DashboardStatus.loading;
    _errorMessage = null;
    notifyListeners();
    try {
      final summary = await _repository.getSummary();
      final t = summary.tasks;

      _openTaskCount = t.openCount;
      _pastDueTaskCount = t.pastDueCount;
      _todayTasksRemainingCount = t.todayRemainingCount;
      _todayTasksTotalCount = t.todayTotalCount;
      _thisWeekTasksRemainingCount = t.thisWeekRemainingCount;
      _thisWeekTasksTotalCount = t.thisWeekTotalCount;
      _dueThisWeekCount = t.thisWeekRemainingCount;
      _unscheduledTaskCount = t.unscheduledCount;
      _recentTasks = t.recent;
      _pastDueTasks = t.pastDue;
      _todayTasks = t.today;
      _thisWeekTasks = t.thisWeek;
      _unscheduledTasks = t.unscheduled;

      _activeRhythms = summary.rhythms;
      _activeRhythmsCount = summary.rhythms.length;

      _activeProjects = summary.projects;
      _activeProjectsCount = summary.projects.length;

      _messageThreadCount = summary.messages.threadCount;
      _unreadMessages = summary.messages.unreadPreviews;

      _status = DashboardStatus.ready;
    } catch (e) {
      _errorMessage = e.toString();
      _status = DashboardStatus.error;
    }
    notifyListeners();
  }

  Future<void> refresh() => load();

  Future<void> createTask(String title, {String? dueDate}) async {
    try {
      await _repository.createTask(title, dueDate: dueDate);
      await refresh();
    } catch (e) {
      _errorMessage = e.toString();
      notifyListeners();
    }
  }

  Future<void> toggleTaskDone(String id) async {
    final task = _findTaskById(id);
    if (task == null) return;
    try {
      await _repository.toggleTaskDone(id, task.status);
      await refresh();
    } catch (e) {
      _errorMessage = e.toString();
      notifyListeners();
    }
  }

  Task? _findTaskById(String id) {
    for (final task in [
      ..._recentTasks,
      ..._thisWeekTasks,
      ..._todayTasks,
      ..._unscheduledTasks,
    ]) {
      if (task.id == id) return task;
    }
    return null;
  }
}
