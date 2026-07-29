import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/agent_model_route.dart';
import '../models/catalog_model_entry.dart';

class AgentModelsDataSource {
  AgentModelsDataSource({http.Client? client})
      : _baseUrl = AppConstants.agentLocalBaseUrl,
        _client = client ?? http.Client();

  final String _baseUrl;

  // Injectable so the catalog→picker flow can be exercised end-to-end against a
  // fake backend (see opc_openrouter_curation_picker_test.dart). Defaults to a
  // real client in production.
  final http.Client _client;

  /// Fetches the catalogue of available (provider, model, routeKind) rows for
  /// [agentId]. Only authed providers are returned by the server.
  ///
  /// Returns an empty list on any error so callers can degrade gracefully.
  Future<List<AgentModelRoute>> fetchRoutes(String agentId) async {
    try {
      final uri = Uri.parse(
        '$_baseUrl/agents/models',
      ).replace(queryParameters: {'agentId': agentId});
      final response =
          await _client.get(uri, headers: AuthSessionStore.headers());
      assertOk(response);
      final list = jsonDecode(response.body) as List<dynamic>;
      return list
          .map(
            (j) => AgentModelRoute.fromJson(j as Map<String, dynamic>),
          )
          .toList();
    } catch (_) {
      return [];
    }
  }

  /// Fetches the full cross-agent model catalog from GET /agents/models/catalog.
  ///
  /// Returns every (agent, provider, model) triple annotated with auth state.
  /// Returns an empty list on any error so callers can degrade gracefully.
  Future<List<CatalogModelEntry>> fetchCatalog() async {
    try {
      final uri = Uri.parse('$_baseUrl/agents/models/catalog');
      final response =
          await _client.get(uri, headers: AuthSessionStore.headers());
      assertOk(response);
      final list = jsonDecode(response.body) as List<dynamic>;
      return list
          .map((j) => CatalogModelEntry.fromJson(j as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  /// Persists a session-level model override via PATCH /agent-sessions/:id.
  Future<void> updateSessionModel(
    String sessionId,
    String providerId,
    String modelId,
  ) async {
    final response = await _client.patch(
      Uri.parse('$_baseUrl/agent-sessions/$sessionId'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'providerId': providerId, 'modelId': modelId}),
    );
    assertOk(response);
  }
}
