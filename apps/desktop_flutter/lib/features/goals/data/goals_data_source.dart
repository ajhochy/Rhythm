import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/goal.dart';

class GoalsDataSource {
  GoalsDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<List<Goal>> fetchAll() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/goals'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    return (jsonDecode(response.body) as List<dynamic>)
        .map((item) => Goal.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<Goal> create(Map<String, dynamic> values) => _write(null, values);

  Future<Goal> update(String id, Map<String, dynamic> values) =>
      _write(id, values);

  Future<Goal> _write(String? id, Map<String, dynamic> values) async {
    final uri =
        Uri.parse(id == null ? '$_baseUrl/goals' : '$_baseUrl/goals/$id');
    final response = id == null
        ? await http.post(
            uri,
            headers: AuthSessionStore.headers(json: true),
            body: jsonEncode(values),
          )
        : await http.patch(
            uri,
            headers: AuthSessionStore.headers(json: true),
            body: jsonEncode(values),
          );
    assertOk(response);
    return Goal.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<void> delete(String id) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/goals/$id'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }
}
