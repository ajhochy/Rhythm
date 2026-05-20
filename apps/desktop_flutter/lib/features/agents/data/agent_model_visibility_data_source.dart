/// Issue #609 — Data source for agent model visibility CRUD and OpenRouter catalog.
library;

import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/agent_model_route.dart';

class AgentModelVisibilityDataSource {
  AgentModelVisibilityDataSource() : _baseUrl = AppConstants.agentLocalBaseUrl;

  final String _baseUrl;

  /// Fetches existing visibility rows from the server.
  Future<List<AgentModelVisibility>> fetchVisibility() async {
    try {
      final res = await http.get(
        Uri.parse('$_baseUrl/agent-models/visibility'),
        headers: AuthSessionStore.headers(),
      );
      assertOk(res);
      final list = jsonDecode(res.body) as List<dynamic>;
      return list
          .map((j) => AgentModelVisibility.fromJson(j as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  /// Bulk-upserts visibility rows.
  Future<void> patchVisibility(
    List<AgentModelVisibility> updates,
  ) async {
    final body = jsonEncode({
      'updates': updates
          .map((v) => {
                'provider': v.provider,
                'modelId': v.modelId,
                'visible': v.visible,
              })
          .toList(),
    });
    final res = await http.patch(
      Uri.parse('$_baseUrl/agent-models/visibility'),
      headers: AuthSessionStore.headers(json: true),
      body: body,
    );
    assertOk(res);
  }

  /// Fetches the OpenRouter public model catalog (server-side proxy, cached 1 h).
  Future<List<OpenRouterModelEntry>> fetchOpenRouterModels() async {
    try {
      final res = await http.get(
        Uri.parse('$_baseUrl/opencode/models?provider=openrouter'),
        headers: AuthSessionStore.headers(),
      );
      assertOk(res);
      final list = jsonDecode(res.body) as List<dynamic>;
      return list
          .map((j) => OpenRouterModelEntry.fromJson(j as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }
}
