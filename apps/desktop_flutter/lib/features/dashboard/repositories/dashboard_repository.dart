import '../../messages/models/message_thread.dart';
import '../../projects/models/project_instance.dart';
import '../../projects/models/project_template.dart';
import '../../tasks/models/recurring_task_rule.dart';
import '../../tasks/models/task.dart';
import '../data/dashboard_data_source.dart';
import '../models/dashboard_overview_models.dart';

class DashboardRepository {
  DashboardRepository(this._dataSource);

  final DashboardDataSource _dataSource;

  Future<List<Task>> getTasks() => _dataSource.fetchTasks();

  Future<List<RecurringTaskRule>> getRecurringRules() =>
      _dataSource.fetchRecurringRules();

  Future<List<ProjectTemplate>> getProjectTemplates() =>
      _dataSource.fetchProjectTemplates();

  Future<List<ProjectInstance>> getProjectInstances() =>
      _dataSource.fetchProjectInstances();

  Future<List<MessageThread>> getMessageThreads() =>
      _dataSource.fetchMessageThreads();

  Future<Task> createTask(String title, {String? dueDate}) =>
      _dataSource.createTask(title, dueDate: dueDate);

  Future<Task> toggleTaskDone(String id, String currentStatus) =>
      _dataSource.toggleTaskDone(id, currentStatus);

  Future<Task> updateTask(
    String id, {
    String? title,
    String? notes,
    String? dueDate,
    String? scheduledDate,
    bool includeNotes = false,
    bool includeDueDate = false,
    bool includeScheduledDate = false,
  }) =>
      _dataSource.updateTask(
        id,
        title: title,
        notes: notes,
        dueDate: dueDate,
        scheduledDate: scheduledDate,
        includeNotes: includeNotes,
        includeDueDate: includeDueDate,
        includeScheduledDate: includeScheduledDate,
      );

  Future<ProjectInstanceStep> updateProjectInstanceStepStatus(
    String stepId,
    String status,
  ) =>
      _dataSource.updateProjectInstanceStepStatus(stepId, status);

  Future<ProjectInstanceStep> updateProjectInstanceStep(
    String stepId, {
    String? title,
    String? dueDate,
    String? status,
    String? notes,
    int? assigneeId,
    bool includeNotes = false,
  }) =>
      _dataSource.updateProjectInstanceStep(
        stepId,
        title: title,
        dueDate: dueDate,
        status: status,
        notes: notes,
        assigneeId: assigneeId,
        includeNotes: includeNotes,
      );

  /// Builds unread message previews using an already-fetched [threads] list
  /// to avoid a redundant HTTP call to /message-threads.
  Future<List<DashboardUnreadMessagePreview>> getUnreadMessagePreviews({
    required List<MessageThread> threads,
    int limit = 3,
  }) async {
    final unreadThreads = threads
        .where((thread) => thread.unreadCount > 0)
        .toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));

    final previews = <DashboardUnreadMessagePreview>[];
    for (final thread in unreadThreads.take(limit)) {
      final messages = await _dataSource.getMessages(thread.id);
      if (messages.isEmpty) continue;
      final latest = messages.last;
      previews.add(
        DashboardUnreadMessagePreview(
          threadId: thread.id,
          threadTitle: thread.title,
          senderName: latest.senderName,
          preview: latest.content,
          updatedAt: latest.createdAt,
          unreadCount: thread.unreadCount,
        ),
      );
    }
    return previews;
  }
}
