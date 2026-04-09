import 'package:flutter/foundation.dart';

import '../../integrations/models/integration_account.dart';
import '../../integrations/models/planning_center_task_options.dart';
import '../data/automation_rules_data_source.dart';
import '../models/automation_catalog.dart';
import '../models/automation_rule.dart';
import '../repositories/automation_rules_repository.dart';

enum AutomationRulesStatus { idle, loading, error }

class AutomationRulesController extends ChangeNotifier {
  AutomationRulesController(this._repository);

  final AutomationRulesRepository _repository;

  List<AutomationRule> _rules = [];
  List<AutomationTriggerCatalogItem> _triggers = [];
  List<AutomationActionCatalogItem> _actions = [];
  List<AutomationProviderCatalogItem> _providers = [];
  List<IntegrationAccount> _accounts = [];
  PlanningCenterTaskOptions? _planningCenterTaskOptions;
  List<String> _gmailLabels = [];
  AutomationRulePreview? _selectedPreview;
  AutomationRulesStatus _status = AutomationRulesStatus.idle;
  String? _errorMessage;
  final Set<String> _resyncingRuleIds = {};

  List<AutomationRule> get rules => _rules;
  List<AutomationTriggerCatalogItem> get triggers => _triggers;
  List<AutomationActionCatalogItem> get actions => _actions;
  List<AutomationProviderCatalogItem> get providers => _providers;
  List<IntegrationAccount> get accounts => _accounts;
  PlanningCenterTaskOptions? get planningCenterTaskOptions =>
      _planningCenterTaskOptions;
  List<String> get gmailLabels => _gmailLabels;
  AutomationRulePreview? get selectedPreview => _selectedPreview;
  AutomationRulesStatus get status => _status;
  String? get errorMessage => _errorMessage;
  bool isResyncing(String id) => _resyncingRuleIds.contains(id);

  Future<void> load() async {
    _status = AutomationRulesStatus.loading;
    _errorMessage = null;
    _selectedPreview = null;
    notifyListeners();
    try {
      final results = await Future.wait<dynamic>([
        _repository.getAll(),
        _repository.getTriggers(),
        _repository.getActions(),
        _repository.getProviders(),
        _repository.getAccounts(),
        _repository.getPlanningCenterTaskOptions(),
        _repository.getGmailLabels(),
      ]);
      _rules = results[0] as List<AutomationRule>;
      _triggers = results[1] as List<AutomationTriggerCatalogItem>;
      _actions = results[2] as List<AutomationActionCatalogItem>;
      _providers = results[3] as List<AutomationProviderCatalogItem>;
      _accounts = results[4] as List<IntegrationAccount>;
      _planningCenterTaskOptions = results[5] as PlanningCenterTaskOptions?;
      _gmailLabels = results[6] as List<String>;
      _status = AutomationRulesStatus.idle;
    } catch (e) {
      _errorMessage = e.toString();
      _status = AutomationRulesStatus.error;
    }
    notifyListeners();
  }

  Future<void> loadPreview(String ruleId) async {
    try {
      _selectedPreview = await _repository.getPreview(ruleId);
      notifyListeners();
    } catch (e) {
      _errorMessage = e.toString();
      _status = AutomationRulesStatus.error;
      notifyListeners();
    }
  }

  Future<void> createRule({
    required String name,
    required String source,
    required String triggerKey,
    required String actionType,
    Map<String, dynamic>? triggerConfig,
    Map<String, dynamic>? actionConfig,
    String? sourceAccountId,
    List<AutomationCondition>? conditions,
  }) async {
    try {
      final rule = await _repository.create(
        name: name,
        source: source,
        triggerKey: triggerKey,
        actionType: actionType,
        triggerConfig: triggerConfig,
        actionConfig: actionConfig,
        sourceAccountId: sourceAccountId,
        conditions: conditions,
      );
      _rules = [..._rules, rule];
      _selectedPreview = null;
      notifyListeners();
    } catch (e) {
      _errorMessage = e.toString();
      _status = AutomationRulesStatus.error;
      notifyListeners();
    }
  }

  Future<void> updateRule(
    String id, {
    String? name,
    String? source,
    String? triggerKey,
    String? actionType,
    Map<String, dynamic>? triggerConfig,
    Map<String, dynamic>? actionConfig,
    String? sourceAccountId,
    List<AutomationCondition>? conditions,
  }) async {
    try {
      final updated = await _repository.update(
        id,
        name: name,
        source: source,
        triggerKey: triggerKey,
        actionType: actionType,
        triggerConfig: triggerConfig,
        actionConfig: actionConfig,
        sourceAccountId: sourceAccountId,
        conditions: conditions,
      );
      _rules = _rules.map((r) => r.id == id ? updated : r).toList();
      if (_selectedPreview?.ruleId == id) {
        await loadPreview(id);
        return;
      }
      notifyListeners();
    } catch (e) {
      _errorMessage = e.toString();
      _status = AutomationRulesStatus.error;
      notifyListeners();
    }
  }

  Future<void> toggleEnabled(String id) async {
    final rule = _rules.firstWhere((r) => r.id == id);
    try {
      final updated = await _repository.update(id, enabled: !rule.enabled);
      _rules = _rules.map((r) => r.id == id ? updated : r).toList();
      if (_selectedPreview?.ruleId == id) {
        await loadPreview(id);
        return;
      }
      notifyListeners();
    } catch (e) {
      _errorMessage = e.toString();
      _status = AutomationRulesStatus.error;
      notifyListeners();
    }
  }

  Future<void> deleteRule(String id) async {
    try {
      await _repository.delete(id);
      _rules = _rules.where((r) => r.id != id).toList();
      if (_selectedPreview?.ruleId == id) {
        _selectedPreview = null;
      }
      notifyListeners();
    } catch (e) {
      _errorMessage = e.toString();
      _status = AutomationRulesStatus.error;
      notifyListeners();
    }
  }

  Future<void> resyncRule(String id) async {
    _resyncingRuleIds.add(id);
    _errorMessage = null;
    notifyListeners();
    try {
      await _repository.resync(id);
      await load();
    } catch (e) {
      _errorMessage = e.toString();
      _status = AutomationRulesStatus.error;
      notifyListeners();
    } finally {
      _resyncingRuleIds.remove(id);
      notifyListeners();
    }
  }
}
