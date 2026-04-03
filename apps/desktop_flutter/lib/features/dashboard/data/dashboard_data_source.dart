import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../../messages/models/message.dart';
import '../../messages/models/message_thread.dart';
import '../../projects/models/project_instance.dart';
import '../../projects/models/project_template.dart';
import '../../tasks/models/recurring_task_rule.dart';
import '../../tasks/models/task.dart';
import '../models/dashboard_overview_models.dart';

class DashboardDataSource {
  DashboardDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<List<Task>> fetchTasks() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/tasks'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list.map((j) => Task.fromJson(j as Map<String, dynamic>)).toList();
  }

  Future<List<RecurringTaskRule>> fetchRecurringRules() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/recurring-rules'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => RecurringTaskRule.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<List<ProjectTemplate>> fetchProjectTemplates() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/project-templates'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => ProjectTemplate.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<List<ProjectInstance>> fetchProjectInstances() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/project-instances'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => ProjectInstance.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<List<MessageThread>> fetchMessageThreads() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/message-threads'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => MessageThread.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<List<DashboardUnreadMessagePreview>> fetchUnreadMessagePreviews({
    List<MessageThread>? threads,
    int limit = 3,
  }) async {
    final sourceThreads = threads ?? await fetchMessageThreads();
    final unreadThreads = sourceThreads
        .where((thread) => thread.unreadCount > 0)
        .toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));

    final previews = <DashboardUnreadMessagePreview>[];
    for (final thread in unreadThreads.take(limit)) {
      final messages = await getMessages(thread.id);
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

  Future<int> fetchProjectInstanceCount() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/project-instances'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list.length;
  }

  Future<int> fetchMessageThreadCount() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/message-threads'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list.length;
  }

  Future<Task> createTask(String title, {String? dueDate}) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/tasks'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({
        'title': title,
        if (dueDate != null) 'dueDate': dueDate,
      }),
    );
    assertOk(response);
    return Task.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<Task> toggleTaskDone(String id, String currentStatus) async {
    final newStatus = currentStatus == 'done' ? 'open' : 'done';
    final response = await http.patch(
      Uri.parse('$_baseUrl/tasks/$id'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'status': newStatus}),
    );
    assertOk(response);
    return Task.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<List<Message>> getMessages(int threadId) async {
    final response = await http.get(
      Uri.parse('$_baseUrl/message-threads/$threadId/messages'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => Message.fromJson(j as Map<String, dynamic>))
        .toList();
  }

}
