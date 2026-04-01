import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/errors/app_error.dart';
import '../../integrations/models/integration_account.dart';
import '../../integrations/models/planning_center_task_options.dart';
import '../models/automation_catalog.dart';
import '../models/automation_rule.dart';

class AutomationRulePreview {
  const AutomationRulePreview({
    required this.ruleId,
    required this.summary,
    this.previewSample,
    this.lastMatchedAt,
    this.lastEvaluatedAt,
    this.matchCountLastRun = 0,
  });

  factory AutomationRulePreview.fromJson(Map<String, dynamic> json) {
    return AutomationRulePreview(
      ruleId: json['ruleId'] as String,
      summary: json['summary'] as String? ?? '',
      previewSample: json['previewSample'] as Map<String, dynamic>?,
      lastMatchedAt: json['lastMatchedAt'] as String?,
      lastEvaluatedAt: json['lastEvaluatedAt'] as String?,
      matchCountLastRun: (json['matchCountLastRun'] as num?)?.toInt() ?? 0,
    );
  }

  final String ruleId;
  final String summary;
  final Map<String, dynamic>? previewSample;
  final String? lastMatchedAt;
  final String? lastEvaluatedAt;
  final int matchCountLastRun;
}

class AutomationRulesDataSource {
  AutomationRulesDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<List<AutomationRule>> fetchAll() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/automation-rules'),
      headers: AuthSessionStore.headers(),
    );
    _assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => AutomationRule.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<List<AutomationTriggerCatalogItem>> fetchTriggers() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/automation-catalog/triggers'),
      headers: AuthSessionStore.headers(),
    );
    _assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((item) => AutomationTriggerCatalogItem.fromJson(
            item as Map<String, dynamic>))
        .toList();
  }

  Future<List<AutomationActionCatalogItem>> fetchActions() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/automation-catalog/actions'),
      headers: AuthSessionStore.headers(),
    );
    _assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((item) => AutomationActionCatalogItem.fromJson(
            item as Map<String, dynamic>))
        .toList();
  }

  Future<List<AutomationProviderCatalogItem>> fetchProviders() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/automation-catalog/providers'),
      headers: AuthSessionStore.headers(),
    );
    _assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((item) => AutomationProviderCatalogItem.fromJson(
            item as Map<String, dynamic>))
        .toList();
  }

  Future<List<IntegrationAccount>> fetchAccounts() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/integrations/accounts'),
      headers: AuthSessionStore.headers(),
    );
    _assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((item) => IntegrationAccount.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<PlanningCenterTaskOptions?> fetchPlanningCenterTaskOptions() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/integrations/planning-center/task-options'),
      headers: AuthSessionStore.headers(),
    );
    if (response.statusCode >= 400) return null;
    return PlanningCenterTaskOptions.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<AutomationRulePreview> fetchPreview(String id) async {
    final response = await http.get(
      Uri.parse('$_baseUrl/automation-rules/$id/preview'),
      headers: AuthSessionStore.headers(),
    );
    _assertOk(response);
    return AutomationRulePreview.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<AutomationRule> create({
    required String name,
    required String source,
    required String triggerKey,
    required String actionType,
    Map<String, dynamic>? triggerConfig,
    Map<String, dynamic>? actionConfig,
    String? sourceAccountId,
    bool enabled = true,
  }) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/automation-rules'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({
        'name': name,
        'source': source,
        'triggerKey': triggerKey,
        'actionType': actionType,
        if (triggerConfig != null) 'triggerConfig': triggerConfig,
        if (actionConfig != null) 'actionConfig': actionConfig,
        if (sourceAccountId != null) 'sourceAccountId': sourceAccountId,
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
    String? source,
    String? triggerKey,
    String? actionType,
    Map<String, dynamic>? triggerConfig,
    Map<String, dynamic>? actionConfig,
    String? sourceAccountId,
    bool? enabled,
  }) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/automation-rules/$id'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({
        if (name != null) 'name': name,
        if (source != null) 'source': source,
        if (triggerKey != null) 'triggerKey': triggerKey,
        if (actionType != null) 'actionType': actionType,
        if (triggerConfig != null) 'triggerConfig': triggerConfig,
        if (actionConfig != null) 'actionConfig': actionConfig,
        if (sourceAccountId != null) 'sourceAccountId': sourceAccountId,
        if (enabled != null) 'enabled': enabled,
      }),
    );
    _assertOk(response);
    return AutomationRule.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<void> delete(String id) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/automation-rules/$id'),
      headers: AuthSessionStore.headers(),
    );
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
