import 'package:flutter/foundation.dart';
import '../../../features/tasks/models/recurring_task_rule.dart';
import '../repositories/rhythms_repository.dart';

enum RhythmsStatus { idle, loading, error }

class RhythmsController extends ChangeNotifier {
  RhythmsController(this._repository);

  final RhythmsRepository _repository;

  List<RecurringTaskRule> _rules = [];
  RhythmsStatus _status = RhythmsStatus.idle;
  String? _errorMessage;

  List<RecurringTaskRule> get rules => _rules;
  RhythmsStatus get status => _status;
  String? get errorMessage => _errorMessage;

  Future<void> load() async {
    _status = RhythmsStatus.loading;
    _errorMessage = null;
    notifyListeners();

    try {
      _rules = await _repository.getAll();
      _status = RhythmsStatus.idle;
    } catch (e) {
      _errorMessage = e.toString();
      _status = RhythmsStatus.error;
    }
    notifyListeners();
  }

  Future<void> updateRule(
    String id, {
    String? title,
    String? frequency,
    int? dayOfWeek,
    int? dayOfMonth,
    int? month,
    bool? enabled,
    List<RecurringTaskRuleStep>? steps,
  }) async {
    try {
      final updated = await _repository.update(id,
          title: title,
          frequency: frequency,
          dayOfWeek: dayOfWeek,
          dayOfMonth: dayOfMonth,
          month: month,
          enabled: enabled,
          steps: steps);
      _rules = _rules.map((r) => r.id == id ? updated : r).toList();
      notifyListeners();
    } catch (e) {
      _errorMessage = e.toString();
      _status = RhythmsStatus.error;
      notifyListeners();
    }
  }

  Future<void> createRule({
    required String title,
    required String frequency,
    int? dayOfWeek,
    int? dayOfMonth,
    int? month,
    List<RecurringTaskRuleStep>? steps,
  }) async {
    try {
      final rule = await _repository.create(
        title: title,
        frequency: frequency,
        dayOfWeek: dayOfWeek,
        dayOfMonth: dayOfMonth,
        month: month,
        steps: steps,
      );
      _rules = [..._rules, rule];
      notifyListeners();
    } catch (e) {
      _errorMessage = e.toString();
      _status = RhythmsStatus.error;
      notifyListeners();
    }
  }

  Future<void> toggleEnabled(String id, {required bool enabled}) async {
    // Optimistic update so the Switch doesn't snap back during the API call.
    _rules = _rules
        .map((r) => r.id == id ? r.copyWith(enabled: enabled) : r)
        .toList();
    notifyListeners();
    try {
      final updated = await _repository.update(id, enabled: enabled);
      _rules = _rules.map((r) => r.id == id ? updated : r).toList();
      notifyListeners();
    } catch (e) {
      // Revert on failure.
      _rules = _rules
          .map((r) => r.id == id ? r.copyWith(enabled: !enabled) : r)
          .toList();
      _errorMessage = e.toString();
      _status = RhythmsStatus.error;
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
      _status = RhythmsStatus.error;
      notifyListeners();
    }
  }
}
