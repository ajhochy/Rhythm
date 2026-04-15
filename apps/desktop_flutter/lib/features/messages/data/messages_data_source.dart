import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/auth/auth_user.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/message.dart';
import '../models/message_thread.dart';

class MessagesDataSource {
  MessagesDataSource({String? baseUrl})
    : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<List<MessageThread>> getThreads() async {
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

  Future<List<AuthUser>> getUsers() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/users'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => AuthUser.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<MessageThread> createThread(
    List<int> participantIds, {
    String? title,
    String threadType = 'direct',
  }) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/message-threads'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({
        'participantIds': participantIds,
        'threadType': threadType,
        if (title != null && title.trim().isNotEmpty) 'title': title.trim(),
      }),
    );
    assertOk(response);
    return MessageThread.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
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

  Future<Message> sendMessage(int threadId, String content) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/message-threads/$threadId/messages'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'body': content}),
    );
    assertOk(response);
    return Message.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<void> markRead(int threadId) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/message-threads/$threadId/read'),
      headers: AuthSessionStore.headers(),
    );
    if (response.statusCode != 204) {
      assertOk(response);
    }
  }

  Future<void> markUnread(int threadId) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/message-threads/$threadId/unread'),
      headers: AuthSessionStore.headers(),
    );
    if (response.statusCode != 204) {
      assertOk(response);
    }
  }
}
