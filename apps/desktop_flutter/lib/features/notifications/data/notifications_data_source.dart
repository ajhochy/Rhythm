import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/app_notification.dart';

class NotificationsDataSource {
  NotificationsDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<List<AppNotification>> fetchUnread() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/notifications'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => AppNotification.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<void> markRead(int id) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/notifications/$id/read'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }

  Future<void> markAllRead() async {
    final response = await http.post(
      Uri.parse('$_baseUrl/notifications/read-all'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }
}
