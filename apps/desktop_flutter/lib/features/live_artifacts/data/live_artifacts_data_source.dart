import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/live_artifact.dart';

class LiveArtifactsDataSource {
  LiveArtifactsDataSource(
      {String? baseUrl, http.Client? client, this.debugOnRequest})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl,
        _client = client;

  final String _baseUrl;
  final http.Client? _client;
  final void Function(String operation)? debugOnRequest;

  Future<List<LiveArtifact>> list() async {
    debugOnRequest?.call('list');
    final response = await (_client?.get ?? http.get)(
      Uri.parse('$_baseUrl/live-artifacts?type=html'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    return (jsonDecode(response.body) as List<dynamic>)
        .cast<Map<String, dynamic>>()
        .map(LiveArtifact.fromJson)
        .toList();
  }

  Future<LiveArtifact> get(String id) async {
    debugOnRequest?.call('get');
    final response = await (_client?.get ?? http.get)(
      Uri.parse('$_baseUrl/live-artifacts/$id'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    return LiveArtifact.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  /// This fetch remains in Flutter so the WebView never receives credentials.
  Future<String> render(String id) async {
    debugOnRequest?.call('render');
    final response = await (_client?.get ?? http.get)(
      Uri.parse('$_baseUrl/live-artifacts/$id/render'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    return response.body;
  }

  Future<LiveArtifact> updateState(
    String id, {
    required int expectedStateRevision,
    required Object? state,
  }) async {
    debugOnRequest?.call('updateState');
    final response = await (_client?.put ?? http.put)(
      Uri.parse('$_baseUrl/live-artifacts/$id/state'),
      headers: {
        ...AuthSessionStore.headers(),
        'Content-Type': 'application/json'
      },
      body: jsonEncode({
        'expectedStateRevision': expectedStateRevision,
        'state': state,
      }),
    );
    assertOk(response);
    return LiveArtifact.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<Object?> readPcoServices(String id, Object? request) async {
    debugOnRequest?.call('readPcoServices');
    final response = await (_client?.post ?? http.post)(
      Uri.parse('$_baseUrl/live-artifacts/$id/capabilities/pco.services.read'),
      headers: {
        ...AuthSessionStore.headers(),
        'Content-Type': 'application/json'
      },
      body: jsonEncode(request),
    );
    assertOk(response);
    return jsonDecode(response.body);
  }
}
