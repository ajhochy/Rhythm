import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/usage_budget.dart';

/// Standalone data source for the Usage Budget tracker. Kept separate from
/// [AgentsDataSource] (which many tests stub) so this read-only feature adds
/// no surface to the widely-implemented agents repository interface.
///
/// Hits the local agent server (never the production server) — usage data is
/// owned by the embedded api_server that bridges the provider credentials.
class UsageBudgetDataSource {
  UsageBudgetDataSource({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        _baseUrl = baseUrl ?? AppConstants.agentLocalBaseUrl;

  final http.Client _client;
  final String _baseUrl;

  /// GET /agents/usage-budget. Pass [force] to bypass the server cache.
  Future<UsageBudgetSnapshot> fetch({bool force = false}) async {
    final uri = Uri.parse('$_baseUrl/agents/usage-budget')
        .replace(queryParameters: force ? {'force': 'true'} : null);
    final response =
        await _client.get(uri, headers: AuthSessionStore.localHeaders());
    assertOk(response);
    return UsageBudgetSnapshot.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }
}
