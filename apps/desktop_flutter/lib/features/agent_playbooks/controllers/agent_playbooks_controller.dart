import 'package:flutter/foundation.dart';

import '../data/agent_playbooks_data_source.dart';

enum AgentPlaybooksStatus { idle, loading, error }

/// Backs the standalone Playbooks manager (Agents → Tools → Playbooks,
/// #1051 / OCU-10). Custom slash-commands are the product-facing "Playbooks"
/// — saved, parameterized prompts run from the slash popover.
///
/// Mirrors [AgentSkillsController]: mutating actions (create/edit/delete) are
/// confined to Rhythm-managed playbooks; built-in/MCP/skill-sourced commands
/// are read-only. All traffic stays on the local agent server (`:4001`).
class AgentPlaybooksController extends ChangeNotifier {
  AgentPlaybooksController(this._dataSource);

  final AgentPlaybooksDataSource _dataSource;

  /// Exposed so the view can hand the same data source to the editor sheet.
  AgentPlaybooksDataSource get dataSource => _dataSource;

  List<PlaybookEntry> _playbooks = [];
  AgentPlaybooksStatus _status = AgentPlaybooksStatus.idle;
  String? _error;

  List<PlaybookEntry> get playbooks => List.unmodifiable(_playbooks);

  AgentPlaybooksStatus get status => _status;

  String? get error => _error;

  /// Live playbook names (used for create-collision guarding in the editor).
  Set<String> get playbookNames => _playbooks.map((p) => p.name).toSet();

  Future<void> loadPlaybooks() async {
    _status = AgentPlaybooksStatus.loading;
    _error = null;
    notifyListeners();
    try {
      _playbooks = await _dataSource.list();
      _status = AgentPlaybooksStatus.idle;
    } catch (e) {
      _error = e.toString();
      _status = AgentPlaybooksStatus.error;
    }
    notifyListeners();
  }

  /// Deletes a Rhythm-managed playbook (built-in/MCP/skill commands cannot be
  /// deleted — the caller gates this on [PlaybookEntry.managed]). Re-fetches
  /// on success so the list reflects the post-reload engine state.
  Future<bool> deletePlaybook(String name) async {
    try {
      await _dataSource.delete(name);
      await loadPlaybooks();
      return true;
    } catch (e) {
      _error = e.toString().replaceFirst('Exception: ', '');
      notifyListeners();
      return false;
    }
  }
}
