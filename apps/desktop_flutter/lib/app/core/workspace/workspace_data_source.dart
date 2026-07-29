import 'dart:convert';

import 'package:http/http.dart' as http;

import '../auth/auth_session_store.dart';
import '../auth/workspace_info.dart';
import '../constants/app_constants.dart';
import '../utils/http_utils.dart';
import 'workspace_models.dart';

class WorkspaceDataSource {
  WorkspaceDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<WorkspaceInfo> create(String name) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/workspaces'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'name': name}),
    );
    assertOk(response);
    return WorkspaceInfo.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<WorkspaceInfo> join(String joinCode) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/workspaces/join'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'joinCode': joinCode}),
    );
    assertOk(response);
    return WorkspaceInfo.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<List<WorkspaceMember>> listMembers() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/workspaces/me/members'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((item) => WorkspaceMember.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<List<WorkspaceMember>> addMemberDirect(int userId) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/workspaces/me/members/add'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'userId': userId}),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((item) => WorkspaceMember.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<void> updateMemberRole(int userId, String role) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/workspaces/me/members/$userId'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'role': role}),
    );
    assertOk(response);
  }

  Future<void> removeMember(int userId) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/workspaces/me/members/$userId'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }

  Future<String> regenerateJoinCode() async {
    final response = await http.post(
      Uri.parse('$_baseUrl/workspaces/me/join-code/regenerate'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return json['joinCode'] as String;
  }
}
