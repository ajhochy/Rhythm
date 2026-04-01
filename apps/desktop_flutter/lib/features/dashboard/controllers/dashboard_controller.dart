import 'package:flutter/foundation.dart';
import '../../tasks/models/task.dart';
import '../data/dashboard_data_source.dart';

enum DashboardStatus { loading, ready, error }

class DashboardController extends ChangeNotifier {
  DashboardController(this._dataSource);

  final DashboardDataSource _dataSource;

  DashboardStatus _status = DashboardStatus.loading;
  String? _errorMessage;

  int _openTaskCount = 0;
  int _dueThisWeekCount = 0;
  int _activeRhythmsCount = 0;
  int _activeProjectsCount = 0;
  int _messageThreadCount = 0;
  List<Task> _recentTasks = [];

  DashboardStatus get status => _status;
  String? get errorMessage => _errorMessage;
  int get openTaskCount => _openTaskCount;
  int get dueThisWeekCount => _dueThisWeekCount;
  int get activeRhythmsCount => _activeRhythmsCount;
  int get activeProjectsCount => _activeProjectsCount;
  int get messageThreadCount => _messageThreadCount;
  List<Task> get recentTasks => _recentTasks;

  Future<void> load() async {
    _status = DashboardStatus.loading;
    _errorMessage = null;
    notifyListeners();
    try {
      final results = await Future.wait([
        _dataSource.fetchTasks(),
        _dataSource.fetchRecurringRules(),
        _dataSource.fetchProjectInstanceCount(),
        _dataSource.fetchMessageThreadCount(),
      ]);

      final tasks = results[0] as List<Task>;
      final rules = results[1] as List;
      final projectCount = results[2] as int;
      final messageCount = results[3] as int;

      final now = DateTime.now();
      final weekFromNow = now.add(const Duration(days: 7));

      _openTaskCount = tasks.where((t) => t.status != 'done').length;
      _dueThisWeekCount = tasks.where((t) {
        if (t.dueDate == null || t.status == 'done') return false;
        final due = DateTime.tryParse(t.dueDate!);
        if (due == null) return false;
        return due.isAfter(now.subtract(const Duration(days: 1))) &&
            due.isBefore(weekFromNow);
      }).length;

      _activeRhythmsCount = rules.where((r) => r.enabled == true).length;
      _activeProjectsCount = projectCount;
      _messageThreadCount = messageCount;

      // Recent tasks: only open tasks, sort by id desc (higher id = newer), take 5
      final sorted = tasks
          .where((task) => task.status != 'done')
          .toList()
        ..sort((a, b) => b.id.compareTo(a.id));
      _recentTasks = sorted.take(5).toList();

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
      final task = await _dataSource.createTask(title, dueDate: dueDate);
      // Insert at front of recent tasks list, keep at most 5
      final updatedRecent = [task, ..._recentTasks].take(5).toList();
      _recentTasks = updatedRecent;
      _openTaskCount += 1;
      notifyListeners();
    } catch (e) {
      _errorMessage = e.toString();
      notifyListeners();
    }
  }

  Future<void> toggleTaskDone(String id) async {
    final idx = _recentTasks.indexWhere((t) => t.id == id);
    if (idx == -1) return;
    final task = _recentTasks[idx];
    try {
      await _dataSource.toggleTaskDone(id, task.status);
      await refresh();
    } catch (e) {
      _errorMessage = e.toString();
      notifyListeners();
    }
  }
}
