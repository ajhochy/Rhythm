import 'package:flutter/foundation.dart';

import '../models/goal.dart';
import '../repositories/goals_repository.dart';

class GoalsController extends ChangeNotifier {
  GoalsController(this._repository);

  final GoalsRepository _repository;
  List<Goal> _goals = const [];
  bool _loading = false;
  String? _errorMessage;

  List<Goal> get goals => _goals;
  bool get loading => _loading;
  String? get errorMessage => _errorMessage;

  Future<void> load() async {
    _loading = true;
    _errorMessage = null;
    notifyListeners();
    try {
      _goals = await _repository.getAll();
    } catch (error) {
      _errorMessage = error.toString();
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> save(Map<String, dynamic> values, {String? id}) async {
    final goal = id == null
        ? await _repository.create(values)
        : await _repository.update(id, values);
    _goals = [
      for (final existing in _goals)
        if (existing.id != goal.id) existing,
      goal,
    ];
    notifyListeners();
  }

  Future<void> remove(String id) async {
    await _repository.delete(id);
    _goals = _goals.where((goal) => goal.id != id).toList();
    notifyListeners();
  }
}
