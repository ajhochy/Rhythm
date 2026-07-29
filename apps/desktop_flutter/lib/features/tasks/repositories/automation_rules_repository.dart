import '../../integrations/models/integration_account.dart';
import '../../integrations/models/planning_center_task_options.dart';
import '../data/automation_rules_data_source.dart';
import '../models/automation_catalog.dart';
import '../models/automation_rule.dart';

class AutomationRulesRepository {
  AutomationRulesRepository(this._dataSource);

  final AutomationRulesDataSource _dataSource;

  Future<List<AutomationRule>> getAll() => _dataSource.fetchAll();
  Future<List<AutomationTriggerCatalogItem>> getTriggers() =>
      _dataSource.fetchTriggers();
  Future<List<AutomationActionCatalogItem>> getActions() =>
      _dataSource.fetchActions();
  Future<List<AutomationProviderCatalogItem>> getProviders() =>
      _dataSource.fetchProviders();
  Future<List<IntegrationAccount>> getAccounts() => _dataSource.fetchAccounts();
  Future<PlanningCenterTaskOptions?> getPlanningCenterTaskOptions() =>
      _dataSource.fetchPlanningCenterTaskOptions();
  Future<List<String>> getGmailLabels() => _dataSource.fetchGmailLabels();
  Future<AutomationRulePreview> getPreview(String id) =>
      _dataSource.fetchPreview(id);

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
  }) =>
      _dataSource.create(
        name: name,
        source: source,
        triggerKey: triggerKey,
        actionType: actionType,
        triggerConfig: triggerConfig,
        actionConfig: actionConfig,
        sourceAccountId: sourceAccountId,
        enabled: enabled,
        conditions: conditions,
      );

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
  }) =>
      _dataSource.update(
        id,
        name: name,
        source: source,
        triggerKey: triggerKey,
        actionType: actionType,
        triggerConfig: triggerConfig,
        actionConfig: actionConfig,
        sourceAccountId: sourceAccountId,
        enabled: enabled,
        conditions: conditions,
      );

  Future<void> delete(String id) => _dataSource.delete(id);
  Future<void> resync(String id) => _dataSource.resync(id);
  Future<List<String>> getProjectTemplateNames() =>
      _dataSource.fetchProjectTemplateNames();
}
