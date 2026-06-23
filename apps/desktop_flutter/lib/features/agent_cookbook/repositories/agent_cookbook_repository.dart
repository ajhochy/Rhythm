import '../data/agent_cookbook_data_source.dart';
import '../models/cookbook_recipe.dart';

class AgentCookbookRepository {
  AgentCookbookRepository(this._dataSource);

  final AgentCookbookDataSource _dataSource;

  Future<List<CookbookRecipe>> list() => _dataSource.list();

  Future<CookbookRecipe> create(Map<String, dynamic> input) =>
      _dataSource.create(input);

  Future<CookbookRecipe> update(String id, Map<String, dynamic> patch) =>
      _dataSource.update(id, patch);

  Future<void> delete(String id) => _dataSource.delete(id);

  Future<String> runRecipe(String id) => _dataSource.runRecipe(id);
}
