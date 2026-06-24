import '../data/agent_skills_data_source.dart';
import '../models/agent_skill.dart';

class AgentSkillsRepository {
  AgentSkillsRepository(this._dataSource);

  final AgentSkillsDataSource _dataSource;

  Future<List<AgentSkill>> getAll() => _dataSource.getSkills();

  Future<AgentSkill> update(String id, {required String status}) =>
      _dataSource.updateSkill(id, status: status);

  Future<void> delete(String id) => _dataSource.deleteSkill(id);
}
