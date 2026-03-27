import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/errors/app_error.dart';
import '../models/automation_rule.dart';

class AutomationRulesDataSource {
  final _base = Uri.parse('${AppConstants.apiBaseUrl}/automation-rules');

  Future<List<AutomationRule>> fetchAll() async {
    final response = await http.get(_base);
    _assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => AutomationRule.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<AutomationRule> create({
    required String name,
    required String triggerType,
    required String actionType,
    Map<String, dynamic>? triggerConfig,
    Map<String, dynamic>? actionConfig,
    bool enabled = true,
  }) async {
    final response = await http.post(
      _base,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'name': name,
        'triggerType': triggerType,
        'actionType': actionType,
        if (triggerConfig != null) 'triggerConfig': triggerConfig,
        if (actionConfig != null) 'actionConfig': actionConfig,
        'enabled': enabled,
      }),
    );
    _assertOk(response);
    return AutomationRule.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<AutomationRule> update(
    String id, {
    String? name,
    String? triggerType,
    String? actionType,
    Map<String, dynamic>? triggerConfig,
    Map<String, dynamic>? actionConfig,
    bool? enabled,
  }) async {
    final response = await http.patch(
      Uri.parse('${AppConstants.apiBaseUrl}/automation-rules/$id'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        if (name != null) 'name': name,
        if (triggerType != null) 'triggerType': triggerType,
        if (actionType != null) 'actionType': actionType,
        if (triggerConfig != null) 'triggerConfig': triggerConfig,
        if (actionConfig != null) 'actionConfig': actionConfig,
        if (enabled != null) 'enabled': enabled,
      }),
    );
    _assertOk(response);
    return AutomationRule.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<void> delete(String id) async {
    final response = await http
        .delete(Uri.parse('${AppConstants.apiBaseUrl}/automation-rules/$id'));
    _assertOk(response);
  }

  void _assertOk(http.Response response) {
    if (response.statusCode >= 400) {
      final body = jsonDecode(response.body) as Map<String, dynamic>?;
      final message =
          (body?['error'] as Map<String, dynamic>?)?['message'] as String? ??
              'Request failed';
      throw AppError(message);
    }
  }
}
