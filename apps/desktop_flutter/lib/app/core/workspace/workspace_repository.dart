import '../auth/workspace_info.dart';
import 'workspace_data_source.dart';
import 'workspace_models.dart';

class WorkspaceRepository {
  WorkspaceRepository(this._dataSource);

  final WorkspaceDataSource _dataSource;

  Future<WorkspaceInfo> create(String name) => _dataSource.create(name);
  Future<WorkspaceInfo> join(String joinCode) => _dataSource.join(joinCode);
  Future<List<WorkspaceMember>> listMembers() => _dataSource.listMembers();
  Future<void> updateMemberRole(int userId, String role) =>
      _dataSource.updateMemberRole(userId, role);
  Future<void> removeMember(int userId) => _dataSource.removeMember(userId);
  Future<String> regenerateJoinCode() => _dataSource.regenerateJoinCode();
}
