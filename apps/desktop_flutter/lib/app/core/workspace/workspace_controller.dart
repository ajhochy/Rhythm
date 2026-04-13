import 'package:flutter/foundation.dart';

import 'workspace_models.dart';
import 'workspace_repository.dart';

enum WorkspaceStatus { idle, loading, error }

class WorkspaceController extends ChangeNotifier {
  WorkspaceController(this._repository);

  final WorkspaceRepository _repository;

  List<WorkspaceMember> _members = [];
  WorkspaceStatus _status = WorkspaceStatus.idle;
  String? _errorMessage;

  List<WorkspaceMember> get members => _members;
  WorkspaceStatus get status => _status;
  String? get errorMessage => _errorMessage;

  Future<void> loadMembers() async {
    _status = WorkspaceStatus.loading;
    notifyListeners();
    try {
      _members = await _repository.listMembers();
      _status = WorkspaceStatus.idle;
    } catch (e) {
      _errorMessage = e.toString();
      _status = WorkspaceStatus.error;
    }
    notifyListeners();
  }

  Future<void> updateMemberRole(int userId, String role) async {
    await _repository.updateMemberRole(userId, role);
    await loadMembers();
  }

  Future<void> removeMember(int userId) async {
    await _repository.removeMember(userId);
    await loadMembers();
  }

  Future<String> regenerateJoinCode() async {
    return _repository.regenerateJoinCode();
  }
}
