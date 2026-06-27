import 'package:flutter/foundation.dart';

import '../models/agent_memory_entry.dart';
import '../repositories/agent_memory_repository.dart';

enum AgentMemoryStatus { idle, loading, searching, error }

class AgentMemoryController extends ChangeNotifier {
  AgentMemoryController(this._repository);

  final AgentMemoryRepository _repository;

  List<AgentMemoryEntry> _entries = [];
  AgentMemoryStatus _status = AgentMemoryStatus.idle;
  String? _error;
  String _searchQuery = '';

  List<AgentMemoryEntry> get entries => List.unmodifiable(_entries);
  AgentMemoryStatus get status => _status;
  String? get error => _error;
  String get searchQuery => _searchQuery;
  bool get isSearching => _searchQuery.isNotEmpty;

  // --------------------------------------------------------------------------
  // Load / Search
  // --------------------------------------------------------------------------

  Future<void> refresh() async {
    _status = AgentMemoryStatus.loading;
    _searchQuery = '';
    _error = null;
    notifyListeners();
    try {
      _entries = await _repository.list();
      _status = AgentMemoryStatus.idle;
    } catch (e) {
      _error = e.toString();
      _status = AgentMemoryStatus.error;
    }
    notifyListeners();
  }

  Future<void> search(String q) async {
    _searchQuery = q;
    if (q.isEmpty) {
      await refresh();
      return;
    }
    _status = AgentMemoryStatus.searching;
    _error = null;
    notifyListeners();
    try {
      _entries = await _repository.search(q);
      _status = AgentMemoryStatus.idle;
    } catch (e) {
      _error = e.toString();
      _status = AgentMemoryStatus.error;
    }
    notifyListeners();
  }

  Future<void> clearSearch() async {
    _searchQuery = '';
    await refresh();
  }

  // --------------------------------------------------------------------------
  // Delete
  // --------------------------------------------------------------------------

  Future<bool> delete(String id) async {
    try {
      await _repository.delete(id);
      _entries = _entries.where((e) => e.id != id).toList();
      _error = null;
      notifyListeners();
      return true;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return false;
    }
  }

  Future<void> clearAll() async {
    final ids = _entries.map((e) => e.id).toList();
    for (final id in ids) {
      await delete(id);
    }
  }
}
