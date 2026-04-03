import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/auth/auth_user.dart';
import 'package:rhythm_desktop/features/dashboard/controllers/dashboard_controller.dart';
import 'package:rhythm_desktop/features/dashboard/data/dashboard_data_source.dart';
import 'package:rhythm_desktop/features/messages/controllers/messages_controller.dart';
import 'package:rhythm_desktop/features/messages/data/messages_data_source.dart';
import 'package:rhythm_desktop/features/messages/models/message.dart';
import 'package:rhythm_desktop/features/messages/models/message_thread.dart';
import 'package:rhythm_desktop/features/messages/repositories/messages_repository.dart';
import 'package:rhythm_desktop/features/projects/models/project_instance.dart';
import 'package:rhythm_desktop/features/projects/models/project_template.dart';
import 'package:rhythm_desktop/features/dashboard/models/dashboard_overview_models.dart';
import 'package:rhythm_desktop/features/tasks/models/recurring_task_rule.dart';
import 'package:rhythm_desktop/features/tasks/models/task.dart';

void main() {
  test('DashboardController refreshes recent tasks after toggling done',
      () async {
    final dataSource = _FakeDashboardDataSource();
    final controller = DashboardController(dataSource);

    await controller.load();
    expect(controller.openTaskCount, 3);
    expect(controller.dueThisWeekCount, 1);
    expect(controller.activeRhythms, hasLength(1));
    expect(controller.activeRhythms.first.title, 'Weekly Rhythm');
    expect(controller.activeRhythms.first.completedCount, 1);
    expect(controller.activeRhythms.first.totalCount, 2);
    expect(controller.activeProjects, hasLength(1));
    expect(controller.activeProjects.first.title, 'Project Alpha');
    expect(controller.activeProjects.first.completedCount, 1);
    expect(controller.activeProjects.first.totalCount, 2);

    await controller.toggleTaskDone('2');

    expect(dataSource.loadCount, 2);
    expect(controller.openTaskCount, 2);
  });

  test('MessagesController reloads threads after creating a thread', () async {
    final repository = _FakeMessagesRepository();
    final controller = MessagesController(repository);

    await controller.loadThreads();
    expect(controller.threads, hasLength(1));

    await controller.createThread(const [2]);

    expect(repository.getThreadsCallCount, greaterThanOrEqualTo(2));
    expect(controller.threads, hasLength(2));
    expect(controller.selectedThreadId, 22);
  });

  test(
      'MessagesController polls threads globally and current thread while visible',
      () async {
    final repository = _FakeMessagesRepository();
    final controller = MessagesController(
      repository,
      pollInterval: const Duration(milliseconds: 10),
    );

    await controller.loadThreads();
    await controller.selectThread(11);
    repository.getThreadsCallCount = 0;
    repository.getMessagesCallCount = 0;
    repository.markReadCallCount = 0;

    controller.setPollingEnabled(true);
    await Future<void>.delayed(const Duration(milliseconds: 25));
    final hiddenThreadCalls = repository.getThreadsCallCount;

    expect(hiddenThreadCalls, greaterThanOrEqualTo(2));
    expect(repository.getMessagesCallCount, 0);
    expect(repository.markReadCallCount, 0);

    controller.setScreenActive(true);
    repository.messageFixtures = [
      Message(
        id: 1,
        threadId: 11,
        senderName: 'Alice',
        content: 'Hello',
        createdAt: DateTime.parse('2026-03-31T01:00:00.000Z'),
      ),
      Message(
        id: 2,
        threadId: 11,
        senderName: 'Bob',
        content: 'Reply',
        createdAt: DateTime.parse('2026-03-31T01:01:00.000Z'),
      ),
    ];
    await Future<void>.delayed(const Duration(milliseconds: 25));

    expect(repository.getThreadsCallCount, greaterThan(hiddenThreadCalls));
    expect(repository.getMessagesCallCount, greaterThanOrEqualTo(1));
    expect(repository.markReadCallCount, greaterThanOrEqualTo(1));
    expect(controller.incomingNotice, isNotNull);
    expect(controller.incomingNotice?.senderName, 'Bob');

    controller.setPollingEnabled(false);
  });
}

class _FakeDashboardDataSource extends DashboardDataSource {
  _FakeDashboardDataSource() : super(baseUrl: 'http://example.invalid');

  int loadCount = 0;
  bool toggledTaskDone = false;

  @override
  Future<List<Task>> fetchTasks() async {
    loadCount += 1;
    return [
      Task(
        id: '1',
        title: 'Older task',
        status: 'open',
        createdAt: '2026-03-30T00:00:00.000Z',
        updatedAt: '2026-03-30T00:00:00.000Z',
      ),
      Task(
        id: '2',
        title: 'Recent task',
        status: toggledTaskDone ? 'done' : 'open',
        createdAt: '2026-03-31T00:00:00.000Z',
        updatedAt: '2026-03-31T00:00:00.000Z',
      ),
      Task(
        id: '3',
        title: 'Rhythm step one',
        status: 'done',
        dueDate: '2026-04-01',
        sourceType: 'recurring_rule',
        sourceId: 'rule-1',
        createdAt: '2026-03-31T00:00:00.000Z',
        updatedAt: '2026-03-31T00:00:00.000Z',
      ),
      Task(
        id: '4',
        title: 'Rhythm step two',
        status: 'open',
        dueDate: '2026-04-04',
        sourceType: 'recurring_rule',
        sourceId: 'rule-1',
        createdAt: '2026-03-31T00:00:00.000Z',
        updatedAt: '2026-03-31T00:00:00.000Z',
      ),
    ];
  }

  @override
  Future<List<RecurringTaskRule>> fetchRecurringRules() async => [
        RecurringTaskRule(
          id: 'rule-1',
          title: 'Weekly Rhythm',
          frequency: 'weekly',
          dayOfWeek: 1,
          dayOfMonth: null,
          month: null,
          enabled: true,
          createdAt: '2026-03-29T00:00:00.000Z',
        ),
      ];

  @override
  Future<List<ProjectTemplate>> fetchProjectTemplates() async => [
        ProjectTemplate(
          id: 'template-1',
          name: 'Project Alpha',
          anchorType: 'date',
          createdAt: '2026-03-29T00:00:00.000Z',
          steps: const [],
        ),
      ];

  @override
  Future<List<ProjectInstance>> fetchProjectInstances() async => [
        ProjectInstance(
          id: 'project-1',
          templateId: 'template-1',
          name: 'Project Alpha',
          anchorDate: '2026-03-31',
          status: 'active',
          createdAt: '2026-03-31T00:00:00.000Z',
          steps: [
            ProjectInstanceStep(
              id: 'step-1',
              instanceId: 'project-1',
              stepId: 'template-step-1',
              title: 'Step one',
              dueDate: '2026-04-01',
              status: 'done',
              notes: null,
            ),
            ProjectInstanceStep(
              id: 'step-2',
              instanceId: 'project-1',
              stepId: 'template-step-2',
              title: 'Step two',
              dueDate: '2026-04-03',
              status: 'open',
              notes: null,
            ),
          ],
        ),
      ];

  @override
  Future<int> fetchProjectInstanceCount() async => 1;

  @override
  Future<List<MessageThread>> fetchMessageThreads() async => const [];

  @override
  Future<List<DashboardUnreadMessagePreview>> fetchUnreadMessagePreviews({
    List<MessageThread>? threads,
    int limit = 3,
  }) async =>
      const [];

  @override
  Future<int> fetchMessageThreadCount() async => 0;

  @override
  Future<Task> toggleTaskDone(String id, String currentStatus) async {
    toggledTaskDone = true;
    return Task(
      id: id,
      title: 'Recent task',
      status: 'done',
      createdAt: '2026-03-31T00:00:00.000Z',
      updatedAt: '2026-03-31T00:00:00.000Z',
    );
  }
}

class _FakeMessagesRepository extends MessagesRepository {
  _FakeMessagesRepository()
      : super(MessagesDataSource(baseUrl: 'http://example.invalid'));

  int getThreadsCallCount = 0;
  int getMessagesCallCount = 0;
  int markReadCallCount = 0;
  final List<MessageThread> _threads = [
    MessageThread(
      id: 11,
      title: 'Existing thread',
      updatedAt: DateTime.parse('2026-03-31T00:00:00.000Z'),
      unreadCount: 0,
    ),
  ];

  @override
  Future<List<MessageThread>> getThreads() async {
    getThreadsCallCount += 1;
    return List<MessageThread>.from(_threads);
  }

  @override
  Future<List<AuthUser>> getUsers() async => const [
        AuthUser(id: 2, name: 'Bob', email: 'bob@example.com', role: 'member'),
      ];

  @override
  Future<MessageThread> createThread(List<int> participantIds,
      {String? title}) async {
    final thread = MessageThread(
      id: 22,
      title: title ?? 'Bob',
      updatedAt: DateTime.parse('2026-03-31T01:00:00.000Z'),
      unreadCount: 0,
    );
    _threads.insert(0, thread);
    return thread;
  }

  List<Message> messageFixtures = [
    Message(
      id: 1,
      threadId: 11,
      senderName: 'Alice',
      content: 'Hello',
      createdAt: DateTime.parse('2026-03-31T01:00:00.000Z'),
    ),
  ];

  @override
  Future<List<Message>> getMessages(int threadId) async {
    getMessagesCallCount += 1;
    return messageFixtures;
  }

  @override
  Future<void> markRead(int threadId) async {
    markReadCallCount += 1;
  }
}
