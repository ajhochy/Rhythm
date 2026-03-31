import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/errors/app_error.dart';
import '../models/message.dart';
import '../models/message_thread.dart';

class MessagesDataSource {
  MessagesDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<List<MessageThread>> getThreads() async {
    final response = await http.get(Uri.parse('$_baseUrl/message-threads'));
    _assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => MessageThread.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<MessageThread> createThread(String title) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/message-threads'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'title': title}),
    );
    _assertOk(response);
    return MessageThread.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<List<Message>> getMessages(int threadId) async {
    final response = await http
        .get(Uri.parse('$_baseUrl/message-threads/$threadId/messages'));
    _assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => Message.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<Message> sendMessage(
    int threadId,
    String senderName,
    String content,
  ) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/message-threads/$threadId/messages'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'sender_name': senderName,
        'body': content,
      }),
    );
    _assertOk(response);
    return Message.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  void _assertOk(http.Response response) {
    if (response.statusCode >= 400) {
      final body = jsonDecode(response.body) as Map<String, dynamic>?;
      final message =
          (body?['error'] as Map<String, dynamic>?)?['message'] as String? ??
              'Request failed';
      throw AppError(message);
    }
  }
}
