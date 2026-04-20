import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../../../app/core/utils/json_parsing.dart';
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
      ruleId: asString(json['ruleId']) ?? '',
      summary: asString(json['summary']) ?? '',
      previewSample: json['previewSample'] as Map<String, dynamic>?,
      lastMatchedAt: asString(json['lastMatchedAt']),
      lastEvaluatedAt: asString(json['lastEvaluatedAt']),
      matchCountLastRun: asInt(json['matchCountLastRun']) ?? 0,
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
    assertOk(response);
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
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map(
          (item) => AutomationTriggerCatalogItem.fromJson(
            item as Map<String, dynamic>,
          ),
        )
        .toList();
  }

  Future<List<AutomationActionCatalogItem>> fetchActions() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/automation-catalog/actions'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map(
          (item) => AutomationActionCatalogItem.fromJson(
            item as Map<String, dynamic>,
          ),
        )
        .toList();
  }

  Future<List<AutomationProviderCatalogItem>> fetchProviders() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/automation-catalog/providers'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map(
          (item) => AutomationProviderCatalogItem.fromJson(
            item as Map<String, dynamic>,
          ),
        )
        .toList();
  }

  Future<List<IntegrationAccount>> fetchAccounts() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/integrations/accounts'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map(
          (item) => IntegrationAccount.fromJson(item as Map<String, dynamic>),
        )
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

  Future<List<String>> fetchGmailLabels() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/integrations/gmail/labels'),
      headers: AuthSessionStore.headers(),
    );
    if (response.statusCode >= 400) return const [];
    final list = jsonDecode(response.body) as List<dynamic>;
    return list.map((item) => item as String).toList();
  }

  Future<AutomationRulePreview> fetchPreview(String id) async {
    final response = await http.get(
      Uri.parse('$_baseUrl/automation-rules/$id/preview'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
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
    List<AutomationCondition>? conditions,
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
        if (conditions != null && conditions.isNotEmpty)
          'conditions': conditions.map((c) => c.toJson()).toList(),
      }),
    );
    assertOk(response);
    return AutomationRule.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
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
    List<AutomationCondition>? conditions,
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
        'conditions': conditions?.map((c) => c.toJson()).toList() ?? const [],
      }),
    );
    assertOk(response);
    return AutomationRule.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<void> delete(String id) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/automation-rules/$id'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }

  Future<void> resync(String id) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/automation-rules/$id/resync'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }

  Future<List<String>> fetchProjectTemplateNames() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/project-templates'),
      headers: AuthSessionStore.headers(),
    );
    if (response.statusCode >= 400) return const [];
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => (j as Map<String, dynamic>)['name']?.toString() ?? '')
        .where((n) => n.isNotEmpty)
        .toList();
  }
}
