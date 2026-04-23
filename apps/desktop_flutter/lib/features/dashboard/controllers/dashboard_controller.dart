import 'package:flutter/foundation.dart';

import '../../messages/models/message_thread.dart';
import '../../projects/models/project_instance.dart';
import '../../projects/models/project_template.dart';
import '../../tasks/models/recurring_task_rule.dart';
import '../../tasks/models/task.dart';
import '../models/dashboard_overview_models.dart';
import '../repositories/dashboard_repository.dart';

enum DashboardStatus { loading, ready, error }

class DashboardController extends ChangeNotifier {
  DashboardController(this._repository, {DateTime Function()? now})
      : _now = now ?? DateTime.now;

  final DashboardRepository _repository;
  final DateTime Function() _now;

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
  List<Task> _handoffTasks = [];
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
  List<Task> get handoffTasks => _handoffTasks;
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
      final results = await Future.wait([
        _repository.getTasks(),
        _repository.getRecurringRules(),
        _repository.getMessageThreads(),
      ]);

      final tasks = results[0] as List<Task>;
      final rules = results[1] as List<RecurringTaskRule>;
      final threads = results[2] as List<MessageThread>;

      final now = _now();
      final today = _stripDate(now)!;
      final weekEnd = _endOfIsoWeek(today);

      _openTaskCount = tasks.where((t) => t.status != 'done').length;
      _pastDueTasks = tasks.where((t) => _isPastDue(t, today)).toList()
        ..sort(_compareTasks);
      _todayTasks = tasks.where((t) => _isDueToday(t, today)).toList()
        ..sort(_compareTasks);
      _thisWeekTasks = tasks
          .where((t) => _isDueThisWeek(t, today, weekEnd))
          .toList()
        ..sort(_compareTasks);
      _unscheduledTasks = tasks.where(_isUnscheduled).toList()
        ..sort((a, b) => b.id.compareTo(a.id));
      _handoffTasks = tasks.where(_hasOpenHandoffContext).toList()
        ..sort(_compareTasks);
      _pastDueTaskCount = _pastDueTasks.length;
      _todayTasksRemainingCount = _todayTasks.length;
      _todayTasksTotalCount = tasks
          .where((task) => _isDueToday(task, today, includeDone: true))
          .length;
      _thisWeekTasksRemainingCount = _thisWeekTasks.length;
      _thisWeekTasksTotalCount = tasks
          .where(
            (task) => _isDueThisWeek(task, today, weekEnd, includeDone: true),
          )
          .length;
      _unscheduledTaskCount = _unscheduledTasks.length;
      _dueThisWeekCount = _thisWeekTasksRemainingCount;

      _activeRhythms = _buildRhythmSummaries(tasks, rules);
      _activeProjects = await _loadProjectSummaries();
      _activeRhythmsCount = _activeRhythms.length;
      _activeProjectsCount = _activeProjects.length;

      _messageThreadCount = threads.length;
      _unreadMessages = await _repository.getUnreadMessagePreviews(
        threads: threads,
      );

      final sortedRecent = tasks.where((task) => task.status != 'done').toList()
        ..sort(_compareTasks);
      _recentTasks = sortedRecent.take(5).toList();

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

  List<DashboardRhythmProgress> _buildRhythmSummaries(
    List<Task> tasks,
    List<RecurringTaskRule> rules,
  ) {
    final summaries = <DashboardRhythmProgress>[];
    for (final rule in rules) {
      if (!rule.enabled) continue;
      final ruleTasks = tasks
          .where(
            (task) =>
                task.sourceType == 'recurring_rule' &&
                task.sourceId != null &&
                (task.sourceId == rule.id ||
                    task.sourceId!.startsWith('${rule.id}:')),
          )
          .toList()
        ..sort(_compareTasks);
      final completed = ruleTasks.where((task) => task.status == 'done').length;
      summaries.add(
        DashboardRhythmProgress(
          id: rule.id,
          title: rule.title,
          subtitle: rule.patternDescription,
          completedCount: completed,
          totalCount: ruleTasks.length,
        ),
      );
    }
    summaries.sort((a, b) {
      final progressCompare = a.progress.compareTo(b.progress);
      if (progressCompare != 0) return progressCompare;
      return a.title.toLowerCase().compareTo(b.title.toLowerCase());
    });
    return summaries;
  }

  List<DashboardProjectProgress> _buildProjectSummaries(
    List<ProjectInstance> instances,
    Map<String, ProjectTemplate> templatesById,
  ) {
    final summaries = <DashboardProjectProgress>[];
    for (final instance in instances) {
      if (instance.status == 'done') continue;
      final sortedSteps = [...instance.steps]..sort(_compareProjectSteps);
      final completed =
          sortedSteps.where((step) => step.status == 'done').length;
      final template = templatesById[instance.templateId];
      final title = instance.name?.trim().isNotEmpty == true
          ? instance.name!.trim()
          : template?.name ?? 'Project ${instance.anchorDate}';
      final nextDueDates = sortedSteps
          .where((step) => step.status != 'done')
          .map((step) => step.dueDate)
          .whereType<String>()
          .toList();
      final openSteps =
          sortedSteps.where((step) => step.status != 'done').toList();
      summaries.add(
        DashboardProjectProgress(
          id: instance.id,
          title: title,
          subtitle:
              '$completed of ${sortedSteps.length} step${sortedSteps.length == 1 ? '' : 's'} complete',
          completedCount: completed,
          totalCount: sortedSteps.length,
          nextStepTitle: openSteps.isEmpty ? null : openSteps.first.title,
          nextDueDate: nextDueDates.isEmpty ? null : nextDueDates.first,
          onDeckStepTitles:
              openSteps.skip(1).take(3).map((step) => step.title).toList(),
          ownerId: instance.ownerId,
          collaboratorNames: instance.collaborators
              .map((collaborator) => collaborator.name.trim())
              .where((name) => name.isNotEmpty)
              .toList(),
        ),
      );
    }
    summaries.sort((a, b) {
      final aDue = DateTime.tryParse(a.nextDueDate ?? '') ?? DateTime(9999);
      final bDue = DateTime.tryParse(b.nextDueDate ?? '') ?? DateTime(9999);
      final dueCompare = aDue.compareTo(bDue);
      if (dueCompare != 0) return dueCompare;
      final progressCompare = a.progress.compareTo(b.progress);
      if (progressCompare != 0) return progressCompare;
      return a.title.toLowerCase().compareTo(b.title.toLowerCase());
    });
    return summaries;
  }

  static bool _isPastDue(Task task, DateTime today) {
    if (task.status == 'done') return false;
    final date = _taskPriorityDate(task);
    return date != null && date.isBefore(today);
  }

  static bool _isDueToday(
    Task task,
    DateTime today, {
    bool includeDone = false,
  }) {
    if (!includeDone && task.status == 'done') return false;
    final date = _taskPriorityDate(task);
    return date != null &&
        date.year == today.year &&
        date.month == today.month &&
        date.day == today.day;
  }

  static bool _isDueThisWeek(
    Task task,
    DateTime today,
    DateTime weekEnd, {
    bool includeDone = false,
  }) {
    if (!includeDone && task.status == 'done') return false;
    final date = _taskPriorityDate(task);
    return date != null && date.isAfter(today) && !date.isAfter(weekEnd);
  }

  static bool _isUnscheduled(Task task) =>
      task.status != 'done' &&
      task.dueDate == null &&
      task.scheduledDate == null;

  static bool _hasOpenHandoffContext(Task task) {
    if (task.status == 'done') return false;
    return task.isShared || task.collaborators.isNotEmpty;
  }

  Future<List<DashboardProjectProgress>> _loadProjectSummaries() async {
    try {
      final results = await Future.wait([
        _repository.getProjectTemplates(),
        _repository.getProjectInstances(),
      ]);
      final templates = results[0] as List<ProjectTemplate>;
      final projectInstances = results[1] as List<ProjectInstance>;
      final templatesById = {
        for (final template in templates) template.id: template,
      };
      return _buildProjectSummaries(projectInstances, templatesById);
    } catch (_) {
      return const [];
    }
  }

  static int _compareTasks(Task a, Task b) {
    final aDate = _taskPriorityDate(a) ?? DateTime(9999);
    final bDate = _taskPriorityDate(b) ?? DateTime(9999);
    final dateCompare = aDate.compareTo(bDate);
    if (dateCompare != 0) return dateCompare;
    final aUpdated = DateTime.tryParse(a.updatedAt) ?? DateTime(9999);
    final bUpdated = DateTime.tryParse(b.updatedAt) ?? DateTime(9999);
    final updatedCompare = aUpdated.compareTo(bUpdated);
    if (updatedCompare != 0) return updatedCompare;
    return a.id.compareTo(b.id);
  }

  static int _compareProjectSteps(
    ProjectInstanceStep a,
    ProjectInstanceStep b,
  ) {
    final aDate = DateTime.tryParse(a.dueDate) ?? DateTime(9999);
    final bDate = DateTime.tryParse(b.dueDate) ?? DateTime(9999);
    final compare = aDate.compareTo(bDate);
    if (compare != 0) return compare;
    return a.title.toLowerCase().compareTo(b.title.toLowerCase());
  }

  static DateTime? _taskPriorityDate(Task task) {
    final scheduled = task.scheduledDate == null
        ? null
        : DateTime.tryParse(task.scheduledDate!);
    if (scheduled != null) return _stripDate(scheduled);
    final due = task.dueDate == null ? null : DateTime.tryParse(task.dueDate!);
    return due == null ? null : _stripDate(due);
  }

  static DateTime? _stripDate(DateTime? value) {
    if (value == null) return null;
    return DateTime(value.year, value.month, value.day);
  }

  static DateTime _endOfIsoWeek(DateTime date) {
    final normalized = _stripDate(date)!;
    final daysUntilSunday = DateTime.daysPerWeek - normalized.weekday;
    return normalized.add(Duration(days: daysUntilSunday));
  }

  Task? _findTaskById(String id) {
    for (final task in [
      ..._recentTasks,
      ..._thisWeekTasks,
      ..._todayTasks,
      ..._unscheduledTasks,
      ..._handoffTasks,
    ]) {
      if (task.id == id) return task;
    }
    return null;
  }
}
