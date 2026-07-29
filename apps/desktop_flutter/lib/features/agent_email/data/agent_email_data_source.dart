import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/gmail_signal.dart';

class AgentEmailDataSource {
  AgentEmailDataSource({String? baseUrl})
    : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<List<AgentEmailGmailSignal>> listSignals() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/integrations/gmail-signals'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final List<dynamic> data = jsonDecode(response.body) as List<dynamic>;
    return data
        .map((e) => AgentEmailGmailSignal.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}
