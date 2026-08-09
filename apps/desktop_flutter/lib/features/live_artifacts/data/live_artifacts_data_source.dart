import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/live_artifact.dart';

class LiveArtifactsDataSource {
  LiveArtifactsDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<List<LiveArtifact>> list() async {
    final response = await http.get(
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
    final response = await http.get(
      Uri.parse('$_baseUrl/live-artifacts/$id'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    return LiveArtifact.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }
}
