import '../data/agent_memory_data_source.dart';
import '../models/agent_memory_entry.dart';

class AgentMemoryRepository {
  AgentMemoryRepository(this._dataSource);

  final AgentMemoryDataSource _dataSource;

  Future<List<AgentMemoryEntry>> list() => _dataSource.list();

  Future<List<AgentMemoryEntry>> search(String q) => _dataSource.search(q);

  Future<AgentMemoryEntry> create(Map<String, dynamic> input) =>
      _dataSource.create(input);

  Future<void> delete(String id) => _dataSource.delete(id);

  /// Issue #862 — edit-in-place.
  Future<AgentMemoryEntry> update(String id, Map<String, dynamic> patch) =>
      _dataSource.update(id, patch);
}
