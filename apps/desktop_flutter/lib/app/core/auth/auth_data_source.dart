import 'dart:convert';

import 'package:http/http.dart' as http;

import '../constants/app_constants.dart';
import '../utils/http_utils.dart';
import 'auth_session_store.dart';
import 'auth_user.dart';
import 'workspace_info.dart';

class AuthLoginResponse {
  const AuthLoginResponse({
    required this.sessionToken,
    required this.user,
  });

  final String sessionToken;
  final AuthUser user;
}

class MeResponse {
  const MeResponse({
    required this.user,
    this.workspace,
    this.workspaceRole,
  });

  final AuthUser user;
  final WorkspaceInfo? workspace;
  final String? workspaceRole;
}

class AuthDataSource {
  AuthDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<AuthLoginResponse> loginWithGoogleIdToken(String googleIdToken) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/auth/google/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'googleIdToken': googleIdToken}),
    );
    assertOk(response);
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return AuthLoginResponse(
      sessionToken: json['sessionToken'] as String,
      user: AuthUser.fromJson(json['user'] as Map<String, dynamic>),
    );
  }

  Future<MeResponse> me(String sessionToken) async {
    AuthSessionStore.setSessionToken(sessionToken);
    final response = await http.get(
      Uri.parse('$_baseUrl/auth/me'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    final workspaceJson = json['workspace'] as Map<String, dynamic>?;
    return MeResponse(
      user: AuthUser.fromJson(json['user'] as Map<String, dynamic>),
      workspace:
          workspaceJson != null ? WorkspaceInfo.fromJson(workspaceJson) : null,
      workspaceRole: json['workspaceRole'] as String?,
    );
  }

  Future<void> logout() async {
    final response = await http.post(
      Uri.parse('$_baseUrl/auth/logout'),
      headers: AuthSessionStore.headers(),
    );
    if (response.statusCode != 204) {
      assertOk(response);
    }
  }
}
