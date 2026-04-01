import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:rhythm_desktop/app/core/auth/auth_data_source.dart';
import 'package:rhythm_desktop/app/core/auth/auth_session_service.dart';
import 'package:rhythm_desktop/app/core/auth/auth_user.dart';
import 'package:rhythm_desktop/features/dashboard/controllers/dashboard_controller.dart';
import 'package:rhythm_desktop/features/dashboard/data/dashboard_data_source.dart';
import 'package:rhythm_desktop/features/messages/controllers/messages_controller.dart';
import 'package:rhythm_desktop/features/messages/data/messages_data_source.dart';
import 'package:rhythm_desktop/features/messages/models/message.dart';
import 'package:rhythm_desktop/features/messages/models/message_thread.dart';
import 'package:rhythm_desktop/features/messages/repositories/messages_repository.dart';
import 'package:rhythm_desktop/features/tasks/models/recurring_task_rule.dart';
import 'package:rhythm_desktop/features/tasks/models/task.dart';
import 'package:rhythm_desktop/features/weekly_planner/controllers/weekly_planner_controller.dart';
import 'package:rhythm_desktop/features/weekly_planner/data/weekly_plan_data_source.dart';
import 'package:rhythm_desktop/features/weekly_planner/models/weekly_plan.dart';
import 'package:rhythm_desktop/features/weekly_planner/repositories/weekly_plan_repository.dart';

void main() {
  test('DashboardController refreshes recent tasks after toggling done',
      () async {
    final dataSource = _FakeDashboardDataSource();
    final controller = DashboardController(dataSource);

    await controller.load();
    expect(controller.recentTasks.map((task) => task.id), contains('2'));

    await controller.toggleTaskDone('2');

    expect(dataSource.loadCount, 2);
    expect(controller.recentTasks.map((task) => task.id), isNot(contains('2')));
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

  test('MessagesController totals unread counts across threads', () async {
    final repository = _FakeMessagesRepository()
      ..threadFixtures = [
        MessageThread(
          id: 11,
          title: 'Existing thread',
          updatedAt: DateTime.parse('2026-03-31T00:00:00.000Z'),
          unreadCount: 2,
        ),
        MessageThread(
          id: 12,
          title: 'Another thread',
          updatedAt: DateTime.parse('2026-03-31T00:10:00.000Z'),
          unreadCount: 1,
        ),
      ];
    final controller = MessagesController(repository);

    await controller.loadThreads();

    expect(controller.totalUnreadCount, 3);
  });

  test('MessagesController polls only while the screen is active', () async {
    final repository = _FakeMessagesRepository();
    final controller = MessagesController(
      repository,
      pollInterval: const Duration(milliseconds: 10),
    );

    controller.setScreenActive(true);
    await Future<void>.delayed(const Duration(milliseconds: 25));
    final callsWhileActive = repository.getThreadsCallCount;

    controller.setScreenActive(false);
    await Future<void>.delayed(const Duration(milliseconds: 25));

    expect(callsWhileActive, greaterThanOrEqualTo(2));
    expect(repository.getThreadsCallCount, callsWhileActive);
  });

  test('MessagesController raises an incoming notice for new messages in the open thread',
      () async {
    SharedPreferences.setMockInitialValues({
      'session_token': 'persisted-token',
    });
    final authService = AuthSessionService(_FakeAuthDataSource());
    await authService.restoreSession();

    final repository = _FakeMessagesRepository();
    final controller = MessagesController(
      repository,
      pollInterval: const Duration(milliseconds: 10),
    );

    await controller.loadThreads();
    await controller.selectThread(11);

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

    controller.setScreenActive(true);
    await Future<void>.delayed(const Duration(milliseconds: 25));
    controller.setScreenActive(false);

    expect(controller.incomingNotice, isNotNull);
    expect(controller.incomingNotice?.senderName, 'Bob');
    expect(controller.incomingNotice?.preview, 'Reply');
  });

  test('MessagesController raises an incoming notice for unread activity in another thread',
      () async {
    SharedPreferences.setMockInitialValues({
      'session_token': 'persisted-token',
    });
    final authService = AuthSessionService(_FakeAuthDataSource());
    await authService.restoreSession();

    final repository = _FakeMessagesRepository();
    final controller = MessagesController(repository);

    await controller.loadThreads();

    repository.threadFixtures = [
      MessageThread(
        id: 99,
        title: 'Rhythm Bot',
        updatedAt: DateTime.parse('2026-03-31T01:05:00.000Z'),
        unreadCount: 1,
        lastMessage: 'Your facility reservation was deleted.',
      ),
      ...repository.threadFixtures,
    ];

    await controller.loadThreads(silent: true);

    expect(controller.incomingNotice, isNotNull);
    expect(controller.incomingNotice?.senderName, 'Rhythm Bot');
    expect(
      controller.incomingNotice?.preview,
      'Your facility reservation was deleted.',
    );
  });

  test('WeeklyPlannerController assigns due date when dragging an unscheduled task',
      () async {
    final repository = _FakeWeeklyPlanRepository();
    final controller = WeeklyPlannerController(repository);
    final task = Task(
      id: 'task-1',
      title: 'Unscheduled',
      status: 'open',
      createdAt: '2026-03-31T00:00:00.000Z',
      updatedAt: '2026-03-31T00:00:00.000Z',
    );

    await controller.scheduleTask(task, '2026-04-02');

    expect(repository.lastUpdatedTaskId, 'task-1');
    expect(repository.lastUpdatedDueDate, '2026-04-02');
    expect(repository.lastUpdatedScheduledDate, '2026-04-02');
    expect(repository.scheduleTaskCallCount, 0);
  });

  test('AuthSessionService restores and clears sessions cleanly', () async {
    SharedPreferences.setMockInitialValues({
      'session_token': 'persisted-token',
    });
    final dataSource = _FakeAuthDataSource();
    final service = AuthSessionService(dataSource);

    await service.restoreSession();
    expect(service.isAuthenticated, isTrue);
    expect(service.currentUser?.email, 'alice@example.com');

    await service.logout();
    expect(service.isAuthenticated, isFalse);
    expect(service.currentUser, isNull);
    expect(dataSource.logoutCalled, isTrue);

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('session_token'), isNull);
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
    ];
  }

  @override
  Future<List<RecurringTaskRule>> fetchRecurringRules() async => [];

  @override
  Future<int> fetchProjectInstanceCount() async => 0;

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
  List<MessageThread> threadFixtures = [
    MessageThread(
      id: 11,
      title: 'Existing thread',
      updatedAt: DateTime.parse('2026-03-31T00:00:00.000Z'),
      unreadCount: 0,
    ),
  ];
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
  Future<List<MessageThread>> getThreads() async {
    getThreadsCallCount += 1;
    return List<MessageThread>.from(threadFixtures);
  }

  @override
  Future<List<AuthUser>> getUsers() async => const [
        AuthUser(id: 2, name: 'Bob', email: 'bob@example.com', role: 'member'),
      ];

  @override
  Future<MessageThread> createThread(
    List<int> participantIds,
  ) async {
    final thread = MessageThread(
      id: 22,
      title: 'Alice, Bob',
      updatedAt: DateTime.parse('2026-03-31T01:00:00.000Z'),
      unreadCount: 0,
      participants: const [
        MessageThreadParticipant(
            id: 1, name: 'Alice', email: 'alice@example.com'),
        MessageThreadParticipant(id: 2, name: 'Bob', email: 'bob@example.com'),
      ],
    );
    threadFixtures.insert(0, thread);
    return thread;
  }

  @override
  Future<List<Message>> getMessages(int threadId) async => messageFixtures;

  @override
  Future<void> markRead(int threadId) async {}
}

class _FakeAuthDataSource extends AuthDataSource {
  _FakeAuthDataSource() : super(baseUrl: 'http://example.invalid');

  bool logoutCalled = false;

  @override
  Future<AuthUser> me(String sessionToken) async => const AuthUser(
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        role: 'member',
      );

  @override
  Future<void> logout() async {
    logoutCalled = true;
  }
}

class _FakeWeeklyPlanRepository extends WeeklyPlanRepository {
  _FakeWeeklyPlanRepository()
      : super(WeeklyPlanDataSource(baseUrl: 'http://example.invalid'));

  int scheduleTaskCallCount = 0;
  String? lastUpdatedTaskId;
  String? lastUpdatedDueDate;
  String? lastUpdatedScheduledDate;

  @override
  Future<WeeklyPlan> fetchPlan(String weekLabel) async => WeeklyPlan(
        weekLabel: weekLabel,
        weekStart: '2026-03-30',
        days: const [],
        backlog: const [],
      );

  @override
  Future<Task> scheduleTask(String taskId, String date, {bool locked = false}) async {
    scheduleTaskCallCount += 1;
    return Task(
      id: taskId,
      title: 'Scheduled',
      status: 'open',
      createdAt: '2026-03-31T00:00:00.000Z',
      updatedAt: '2026-03-31T00:00:00.000Z',
      scheduledDate: date,
    );
  }

  @override
  Future<Task> updateTask(
    String taskId, {
    String? notes,
    String? status,
    String? dueDate,
    String? scheduledDate,
    String? sourceType,
  }) async {
    lastUpdatedTaskId = taskId;
    lastUpdatedDueDate = dueDate;
    lastUpdatedScheduledDate = scheduledDate;
    return Task(
      id: taskId,
      title: 'Updated',
      status: status ?? 'open',
      createdAt: '2026-03-31T00:00:00.000Z',
      updatedAt: '2026-03-31T00:00:00.000Z',
      dueDate: dueDate,
      scheduledDate: scheduledDate,
      sourceType: sourceType,
    );
  }
}
