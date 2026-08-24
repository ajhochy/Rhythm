import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/auth/auth_user.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/auto_promotion_settings_state.dart';

const _autoPromotionConfirmationHeader = 'X-Rhythm-Auto-Promotion-Confirmation';
const _autoPromotionConfirmationValue = 'enable-auto-promotion';

class SettingsDataSource {
  SettingsDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<List<AuthUser>> fetchUsers() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/users'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((json) => AuthUser.fromJson(json as Map<String, dynamic>))
        .toList();
  }

  Future<AuthUser> updateUser(
    int userId, {
    String? role,
    bool? isFacilitiesManager,
  }) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/users/$userId'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({
        if (role != null) 'role': role,
        if (isFacilitiesManager != null)
          'isFacilitiesManager': isFacilitiesManager,
      }),
    );
    assertOk(response);
    return AuthUser.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<AutoPromotionSettingsState> fetchAutoPromotionState() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/optimizer/auto-promotion'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    return AutoPromotionSettingsState.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<AutoPromotionSettingsState> setAutoPromotionEnabled(
      bool enabled) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/optimizer/auto-promotion'),
      headers: {
        ...AuthSessionStore.headers(json: true),
        _autoPromotionConfirmationHeader: _autoPromotionConfirmationValue,
      },
      body: jsonEncode({'enabled': enabled}),
    );
    assertOk(response);
    return AutoPromotionSettingsState.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }
}
