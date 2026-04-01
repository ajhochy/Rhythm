import 'package:flutter_test/flutter_test.dart';
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

  @override
  Future<List<Message>> getMessages(int threadId) async => [
        Message(
          id: 1,
          threadId: threadId,
          senderName: 'Alice',
          content: 'Hello',
          createdAt: DateTime.parse('2026-03-31T01:00:00.000Z'),
        ),
      ];

  @override
  Future<void> markRead(int threadId) async {}
}
