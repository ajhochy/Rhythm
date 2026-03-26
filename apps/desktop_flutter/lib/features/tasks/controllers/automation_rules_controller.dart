import 'package:flutter/foundation.dart';
import '../models/automation_rule.dart';
import '../repositories/automation_rules_repository.dart';

enum AutomationRulesStatus { idle, loading, error }

class AutomationRulesController extends ChangeNotifier {
  AutomationRulesController(this._repository);

  final AutomationRulesRepository _repository;

  List<AutomationRule> _rules = [];
  AutomationRulesStatus _status = AutomationRulesStatus.idle;
  String? _errorMessage;

  List<AutomationRule> get rules => _rules;
  AutomationRulesStatus get status => _status;
  String? get errorMessage => _errorMessage;

  Future<void> load() async {
    _status = AutomationRulesStatus.loading;
    _errorMessage = null;
    notifyListeners();
    try {
      _rules = await _repository.getAll();
      _status = AutomationRulesStatus.idle;
    } catch (e) {
      _errorMessage = e.toString();
      _status = AutomationRulesStatus.error;
    }
    notifyListeners();
  }

  Future<void> createRule({
    required String name,
    required String triggerType,
    required String actionType,
  }) async {
    try {
      final rule = await _repository.create(
        name: name,
        triggerType: triggerType,
        actionType: actionType,
      );
      _rules = [..._rules, rule];
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
      notifyListeners();
    } catch (e) {
      _errorMessage = e.toString();
      _status = AutomationRulesStatus.error;
      notifyListeners();
    }
  }
}
