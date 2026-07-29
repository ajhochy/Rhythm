import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/cookbook_recipe.dart';

class AgentCookbookDataSource {
  AgentCookbookDataSource() : _baseUrl = AppConstants.agentLocalBaseUrl;

  final String _baseUrl;

  Future<List<CookbookRecipe>> list() async {
    final response = await http.get(Uri.parse('$_baseUrl/agent-cookbook'));
    assertOk(response);
    final List<dynamic> data = jsonDecode(response.body) as List<dynamic>;
    return data
        .map((e) => CookbookRecipe.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<CookbookRecipe> create(Map<String, dynamic> input) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/agent-cookbook'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(input),
    );
    assertOk(response);
    return CookbookRecipe.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<CookbookRecipe> update(String id, Map<String, dynamic> patch) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/agent-cookbook/$id'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(patch),
    );
    assertOk(response);
    return CookbookRecipe.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<void> delete(String id) async {
    final response =
        await http.delete(Uri.parse('$_baseUrl/agent-cookbook/$id'));
    if (response.statusCode != 204) {
      assertOk(response);
    }
  }

  Future<String> runRecipe(String id) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/agent-cookbook/$id/run'),
      headers: {'Content-Type': 'application/json'},
    );
    assertOk(response);
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return body['sessionId'] as String;
  }
}
