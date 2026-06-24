import '../data/agent_skills_data_source.dart';
import '../models/agent_skill.dart';
import '../models/agent_skill_version.dart';

class AgentSkillsRepository {
  AgentSkillsRepository(this._dataSource);

  final AgentSkillsDataSource _dataSource;

  Future<List<AgentSkill>> getAll() => _dataSource.getSkills();

  Future<AgentSkill> update(String id, {required String status}) =>
      _dataSource.updateSkill(id, status: status);

  Future<void> delete(String id) => _dataSource.deleteSkill(id);

  /// P5-3: version history for a skill.
  Future<List<AgentSkillVersion>> getVersions(String id) =>
      _dataSource.getVersions(id);

  /// P5-3: roll back to a prior version (returns the restored live skill).
  Future<AgentSkill> rollback(String id, int versionNo) =>
      _dataSource.rollback(id, versionNo);
}
