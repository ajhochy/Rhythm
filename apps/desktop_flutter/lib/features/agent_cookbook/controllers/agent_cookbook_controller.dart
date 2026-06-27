import 'package:flutter/foundation.dart';

import '../models/cookbook_recipe.dart';
import '../repositories/agent_cookbook_repository.dart';

enum AgentCookbookStatus { idle, loading, error }

class AgentCookbookController extends ChangeNotifier {
  AgentCookbookController(this._repository);

  final AgentCookbookRepository _repository;

  List<CookbookRecipe> _recipes = [];
  AgentCookbookStatus _status = AgentCookbookStatus.idle;
  String? _error;

  List<CookbookRecipe> get recipes => _recipes;
  AgentCookbookStatus get status => _status;
  String? get error => _error;

  Future<void> loadRecipes() async {
    _status = AgentCookbookStatus.loading;
    _error = null;
    notifyListeners();

    try {
      _recipes = await _repository.list();
      _status = AgentCookbookStatus.idle;
    } catch (e) {
      _error = e.toString();
      _status = AgentCookbookStatus.error;
    }
    notifyListeners();
  }

  Future<void> createRecipe(Map<String, dynamic> input) async {
    try {
      final created = await _repository.create(input);
      _recipes = [..._recipes, created];
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      rethrow;
    }
  }

  Future<void> updateRecipe(String id, Map<String, dynamic> patch) async {
    try {
      final updated = await _repository.update(id, patch);
      _recipes = _recipes.map((r) => r.id == id ? updated : r).toList();
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      rethrow;
    }
  }

  Future<void> deleteRecipe(String id) async {
    try {
      await _repository.delete(id);
      _recipes = _recipes.where((r) => r.id != id).toList();
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      rethrow;
    }
  }

  /// Runs the recipe identified by [id] via POST /agent-cookbook/:id/run.
  /// Returns the sessionId on success, or null on error (error stored in [error]).
  Future<String?> runRecipe(String id) async {
    try {
      final sessionId = await _repository.runRecipe(id);
      notifyListeners();
      return sessionId;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return null;
    }
  }
}
