import 'package:flutter/foundation.dart';

import '../../agents/data/opencode_skills_data_source.dart';

enum AgentSkillsStatus { idle, loading, error }

/// Backs the standalone Skills menu (Agents → Tools → Skills).
///
/// #796 (skill-unify2): reads the UNIFIED engine skill list via
/// `GET /opencode/skills?withMetadata=true`
/// ([OpencodeSkillsDataSource.listWithMetadata]), so the menu lists EVERY engine
/// skill — handwritten, imported, external, and Rhythm-managed — with provenance
/// + auto-apply lifecycle metadata. The old `/agent-skills` DB-only store is no
/// longer read here.
///
/// Mutating actions (create / edit / delete) are confined to Rhythm-managed
/// skills; external + handwritten skills are read-only (improvements happen
/// automatically via the self-improvement loop, which forks an external skill
/// to a managed shadow — there is no manual proposal/approve action). All
/// traffic stays on the local agent server (`:4001`) via the data source.
class AgentSkillsController extends ChangeNotifier {
  AgentSkillsController(this._dataSource);

  final OpencodeSkillsDataSource _dataSource;

  /// Exposed so the view can hand the same data source to the managed-skill
  /// editor sheet (create/edit reuse [OpencodeSkillsDataSource.create]/`update`).
  OpencodeSkillsDataSource get dataSource => _dataSource;

  List<OpencodeSkillEntry> _skills = [];
  AgentSkillsStatus _status = AgentSkillsStatus.idle;
  String? _error;

  List<OpencodeSkillEntry> get skills => List.unmodifiable(_skills);

  AgentSkillsStatus get status => _status;

  String? get error => _error;

  /// The set of live skill names (used for create-collision guarding in the
  /// managed-skill editor).
  Set<String> get skillNames => _skills.map((s) => s.name).toSet();

  Future<void> loadSkills() async {
    _status = AgentSkillsStatus.loading;
    _error = null;
    notifyListeners();
    try {
      _skills = await _dataSource.listWithMetadata();
      _status = AgentSkillsStatus.idle;
    } catch (e) {
      _error = e.toString();
      _status = AgentSkillsStatus.error;
    }
    notifyListeners();
  }

  /// Deletes a Rhythm-managed skill (external skills cannot be deleted — the
  /// caller gates this on [OpencodeSkillEntry.managed]). Re-fetches on success
  /// so the unified list reflects the post-reload engine state.
  Future<bool> deleteSkill(String name) async {
    try {
      await _dataSource.delete(name);
      await loadSkills();
      return true;
    } catch (e) {
      _error = e.toString().replaceFirst('Exception: ', '');
      notifyListeners();
      return false;
    }
  }
}
