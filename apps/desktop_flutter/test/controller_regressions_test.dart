import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/auth/auth_user.dart';
import 'package:rhythm_desktop/features/dashboard/controllers/dashboard_controller.dart';
import 'package:rhythm_desktop/features/dashboard/data/dashboard_data_source.dart';
import 'package:rhythm_desktop/features/dashboard/models/dashboard_overview_models.dart';
import 'package:rhythm_desktop/features/dashboard/repositories/dashboard_repository.dart';
import 'package:rhythm_desktop/features/messages/controllers/messages_controller.dart';
import 'package:rhythm_desktop/features/messages/data/messages_data_source.dart';
import 'package:rhythm_desktop/features/messages/models/message.dart';
import 'package:rhythm_desktop/features/messages/models/message_thread.dart';
import 'package:rhythm_desktop/features/messages/repositories/messages_repository.dart';
import 'package:rhythm_desktop/features/rhythms/controllers/rhythms_controller.dart';
import 'package:rhythm_desktop/features/rhythms/data/rhythms_data_source.dart';
import 'package:rhythm_desktop/features/rhythms/repositories/rhythms_repository.dart';
import 'package:rhythm_desktop/features/tasks/models/recurring_task_rule.dart';
import 'package:rhythm_desktop/features/tasks/models/task.dart';
import 'package:rhythm_desktop/features/tasks/models/task_collaborator.dart';

void main() {
  test(
    'DashboardController refreshes recent tasks after toggling done',
    () async {
      final dataSource = _FakeDashboardDataSource();
      final controller = DashboardController(
        _FakeDashboardRepository(dataSource),
      );

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
    },
  );

  test(
    'DashboardController excludes next-week tasks from this week count',
    () async {
      final controller = DashboardController(
        _FakeDashboardRepository(_FakeDashboardNextWeekDataSource()),
      );

      await controller.load();

      expect(controller.thisWeekTasksRemainingCount, 0);
      expect(controller.thisWeekTasksTotalCount, 0);
      expect(controller.dueThisWeekCount, 0);
    },
  );

  test('DashboardController derives open handoff tasks from shared context',
      () async {
    final controller = DashboardController(
      _FakeDashboardRepository(_FakeDashboardHandoffDataSource()),
    );

    await controller.load();

    expect(controller.handoffTasks.map((task) => task.id), [
      'shared-due',
      'collaborative-unscheduled',
    ]);
  });

  test(
    'DashboardController keeps same-day task order stable when updatedAt changes',
    () async {
      final controller = DashboardController(
        _FakeDashboardRepository(_FakeDashboardStableOrderingDataSource()),
      );

      await controller.load();

      expect(controller.todayTasks.map((task) => task.id), ['early', 'late']);
    },
  );

  test('MessagesController reloads threads after creating a thread', () async {
    final repository = _FakeMessagesRepository();
    final controller = MessagesController(
      repository,
      notifications: _FakeLocalNotificationService(),
    );

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
        notifications: _FakeLocalNotificationService(),
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
    },
  );

  test('RhythmsController loads rules and forwards workflow steps', () async {
    final repository = _FakeRhythmsRepository();
    final controller = RhythmsController(repository);

    await controller.load();
    expect(controller.rules, hasLength(1));
    expect(controller.rules.first.steps, hasLength(2));

    await controller.createRule(
      title: 'New rhythm',
      frequency: 'weekly',
      dayOfWeek: 1,
      steps: [RecurringTaskRuleStep(id: 'prep', title: 'Prep', assigneeId: 2)],
    );

    expect(repository.lastCreateSteps, hasLength(1));
    expect(repository.lastCreateSteps.first.title, 'Prep');
    expect(controller.rules, hasLength(2));

    await controller.updateRule(
      'rule-1',
      title: 'Updated rhythm',
      steps: [
        RecurringTaskRuleStep(id: 'lead', title: 'Lead', assigneeId: null),
      ],
    );

    expect(repository.lastUpdateSteps, hasLength(1));
    expect(repository.lastUpdateSteps.first.id, 'lead');
    expect(controller.rules.first.title, 'Updated rhythm');
  });
}

class _FakeLocalNotificationService extends LocalNotificationService {
  @override
  Future<void> initialize() async {}

  @override
  Future<void> showMessageNotification({
    required int id,
    required String title,
    required String body,
  }) async {}
}

DashboardSummary _buildSummary({
  required int openCount,
  int thisWeekRemainingCount = 0,
  int thisWeekTotalCount = 0,
  List<Task> recent = const [],
  List<DashboardRhythmProgress> rhythms = const [],
  List<DashboardProjectProgress> projects = const [],
}) =>
    DashboardSummary(
      tasks: DashboardSummaryTaskSlice(
        openCount: openCount,
        pastDueCount: 0,
        pastDeadlineCount: 0,
        todayRemainingCount: 0,
        todayTotalCount: 0,
        thisWeekRemainingCount: thisWeekRemainingCount,
        thisWeekTotalCount: thisWeekTotalCount,
        unscheduledCount: 0,
        recent: recent,
        pastDue: const [],
        today: const [],
        thisWeek: const [],
        unscheduled: const [],
      ),
      rhythms: rhythms,
      projects: projects,
      messages: DashboardSummaryMessageSlice(
        threadCount: 0,
        unreadPreviews: const [],
      ),
    );

class _FakeDashboardDataSource extends DashboardDataSource {
  _FakeDashboardDataSource() : super(baseUrl: 'http://example.invalid');

  int loadCount = 0;
  bool toggledTaskDone = false;

  @override
  Future<DashboardSummary> fetchSummary() async {
    loadCount += 1;
    final openCount = toggledTaskDone ? 2 : 3;
    return _buildSummary(
      openCount: openCount,
      thisWeekRemainingCount: 1,
      thisWeekTotalCount: 1,
      recent: [
        Task(
          id: '2',
          title: 'Recent task',
          status: TaskStatus.open,
          createdAt: '2026-03-31T00:00:00.000Z',
          updatedAt: '2026-03-31T00:00:00.000Z',
        ),
      ],
      rhythms: [
        DashboardRhythmProgress(
          id: 'rule-1',
          title: 'Weekly Rhythm',
          subtitle: 'Every Monday',
          completedCount: 1,
          totalCount: 2,
        ),
      ],
      projects: [
        DashboardProjectProgress(
          id: 'project-1',
          title: 'Project Alpha',
          subtitle: '1 of 2 steps complete',
          completedCount: 1,
          totalCount: 2,
          nextDueDate: '2026-04-03',
        ),
      ],
    );
  }

  @override
  Future<Task> toggleTaskDone(String id, String currentStatus) async {
    toggledTaskDone = true;
    return Task(
      id: id,
      title: 'Recent task',
      status: TaskStatus.done,
      createdAt: '2026-03-31T00:00:00.000Z',
      updatedAt: '2026-03-31T00:00:00.000Z',
    );
  }
}

class _FakeDashboardNextWeekDataSource extends _FakeDashboardDataSource {
  @override
  Future<DashboardSummary> fetchSummary() async {
    loadCount += 1;
    return _buildSummary(
      openCount: 2,
      thisWeekRemainingCount: 0,
      thisWeekTotalCount: 0,
    );
  }
}

class _FakeDashboardHandoffDataSource extends _FakeDashboardDataSource {
  @override
  Future<DashboardSummary> fetchSummary() async {
    loadCount += 1;
    return DashboardSummary(
      tasks: DashboardSummaryTaskSlice(
        openCount: 3,
        pastDueCount: 0,
        pastDeadlineCount: 0,
        todayRemainingCount: 1,
        todayTotalCount: 1,
        thisWeekRemainingCount: 0,
        thisWeekTotalCount: 0,
        unscheduledCount: 1,
        recent: const [],
        pastDue: const [],
        today: [
          Task(
            id: 'shared-due',
            title: 'Shared due task',
            status: TaskStatus.open,
            dueDate: '2026-04-09',
            ownerId: 1,
            isShared: true,
            createdAt: '2026-04-08T00:00:00.000Z',
            updatedAt: '2026-04-08T00:00:00.000Z',
          ),
        ],
        thisWeek: const [],
        unscheduled: [
          Task(
            id: 'collaborative-unscheduled',
            title: 'Collaborative task',
            status: TaskStatus.open,
            ownerId: 2,
            collaborators: [TaskCollaborator(userId: 1, name: 'Alice')],
            createdAt: '2026-04-08T00:00:00.000Z',
            updatedAt: '2026-04-08T00:01:00.000Z',
          ),
        ],
      ),
      rhythms: const [],
      projects: const [],
      messages: DashboardSummaryMessageSlice(
        threadCount: 0,
        unreadPreviews: const [],
      ),
    );
  }
}

class _FakeDashboardStableOrderingDataSource extends _FakeDashboardDataSource {
  @override
  Future<DashboardSummary> fetchSummary() async {
    loadCount += 1;
    return DashboardSummary(
      tasks: DashboardSummaryTaskSlice(
        openCount: 2,
        pastDueCount: 0,
        pastDeadlineCount: 0,
        todayRemainingCount: 2,
        todayTotalCount: 2,
        thisWeekRemainingCount: 0,
        thisWeekTotalCount: 0,
        unscheduledCount: 0,
        recent: const [],
        pastDue: const [],
        today: [
          Task(
            id: 'early',
            title: 'First task',
            status: TaskStatus.open,
            dueDate: '2026-04-09',
            createdAt: '2026-04-08T00:00:00.000Z',
            updatedAt: '2026-04-09T12:00:00.000Z',
          ),
          Task(
            id: 'late',
            title: 'Edited task',
            status: TaskStatus.open,
            dueDate: '2026-04-09',
            createdAt: '2026-04-08T01:00:00.000Z',
            updatedAt: '2026-04-09T23:59:00.000Z',
          ),
        ],
        thisWeek: const [],
        unscheduled: const [],
      ),
      rhythms: const [],
      projects: const [],
      messages: DashboardSummaryMessageSlice(
        threadCount: 0,
        unreadPreviews: const [],
      ),
    );
  }
}

class _FakeDashboardRepository extends DashboardRepository {
  _FakeDashboardRepository(super.dataSource);
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
  Future<MessageThread> createThread(
    List<int> participantIds, {
    String? title,
    String threadType = 'direct',
  }) async {
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

class _FakeRhythmsRepository extends RhythmsRepository {
  _FakeRhythmsRepository() : super(_FakeRhythmsDataSource());

  List<RecurringTaskRuleStep> lastCreateSteps = const [];
  List<RecurringTaskRuleStep> lastUpdateSteps = const [];

  final List<RecurringTaskRule> _rules = [
    RecurringTaskRule(
      id: 'rule-1',
      title: 'Weekly Rhythm',
      frequency: 'weekly',
      dayOfWeek: 1,
      dayOfMonth: null,
      month: null,
      enabled: true,
      createdAt: '2026-03-29T00:00:00.000Z',
      steps: [
        RecurringTaskRuleStep(id: 'prep', title: 'Prep', assigneeId: 2),
        RecurringTaskRuleStep(id: 'lead', title: 'Lead', assigneeId: null),
      ],
    ),
  ];

  @override
  Future<List<RecurringTaskRule>> getAll() async => List.of(_rules);

  @override
  Future<List<AuthUser>> getUsers() async => const [
        AuthUser(
            id: 1, name: 'Alice', email: 'alice@example.com', role: 'member'),
        AuthUser(id: 2, name: 'Bob', email: 'bob@example.com', role: 'member'),
      ];

  @override
  Future<RecurringTaskRule> create({
    required String title,
    required String frequency,
    int? dayOfWeek,
    int? dayOfMonth,
    int? month,
    bool? sequential,
    List<RecurringTaskRuleStep>? steps,
  }) async {
    lastCreateSteps = List.of(steps ?? const []);
    final rule = RecurringTaskRule(
      id: 'rule-created',
      title: title,
      frequency: frequency,
      dayOfWeek: dayOfWeek,
      dayOfMonth: dayOfMonth,
      month: month,
      enabled: true,
      createdAt: '2026-04-01T00:00:00.000Z',
      steps: steps ?? const [],
    );
    _rules.add(rule);
    return rule;
  }

  @override
  Future<RecurringTaskRule> update(
    String id, {
    String? title,
    String? frequency,
    int? dayOfWeek,
    int? dayOfMonth,
    int? month,
    bool? enabled,
    bool? sequential,
    List<RecurringTaskRuleStep>? steps,
  }) async {
    lastUpdateSteps = List.of(steps ?? const []);
    final index = _rules.indexWhere((rule) => rule.id == id);
    final existing = _rules[index];
    final updated = RecurringTaskRule(
      id: existing.id,
      title: title ?? existing.title,
      frequency: frequency ?? existing.frequency,
      dayOfWeek: dayOfWeek ?? existing.dayOfWeek,
      dayOfMonth: dayOfMonth ?? existing.dayOfMonth,
      month: month ?? existing.month,
      enabled: enabled ?? existing.enabled,
      createdAt: existing.createdAt,
      steps: steps ?? existing.steps,
    );
    _rules[index] = updated;
    return updated;
  }

  @override
  Future<void> delete(String id) async {
    _rules.removeWhere((rule) => rule.id == id);
  }
}

class _FakeRhythmsDataSource extends RhythmsDataSource {
  _FakeRhythmsDataSource() : super(baseUrl: 'http://example.invalid');
}
