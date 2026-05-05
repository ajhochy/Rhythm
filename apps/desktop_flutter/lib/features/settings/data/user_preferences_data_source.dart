import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';

class UserPreferencesDataSource {
  UserPreferencesDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<Map<String, dynamic>> updateEmailNotifications(bool enabled) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/users/me/preferences'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'emailNotificationsEnabled': enabled}),
    );
    assertOk(response);
    return jsonDecode(response.body) as Map<String, dynamic>;
  }
}
