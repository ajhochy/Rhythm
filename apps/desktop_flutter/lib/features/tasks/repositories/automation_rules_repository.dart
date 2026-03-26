import '../data/automation_rules_data_source.dart';
import '../models/automation_rule.dart';

class AutomationRulesRepository {
  AutomationRulesRepository(this._dataSource);

  final AutomationRulesDataSource _dataSource;

  Future<List<AutomationRule>> getAll() => _dataSource.fetchAll();

  Future<AutomationRule> create({
    required String name,
    required String triggerType,
    required String actionType,
    bool enabled = true,
  }) =>
      _dataSource.create(
        name: name,
        triggerType: triggerType,
        actionType: actionType,
        enabled: enabled,
      );

  Future<AutomationRule> update(
    String id, {
    String? name,
    String? triggerType,
    String? actionType,
    bool? enabled,
  }) =>
      _dataSource.update(
        id,
        name: name,
        triggerType: triggerType,
        actionType: actionType,
        enabled: enabled,
      );

  Future<void> delete(String id) => _dataSource.delete(id);
}
