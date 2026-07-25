import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/agent_research_job.dart';
import '../repositories/agent_research_repository.dart';

enum AgentResearchStatus { idle, loading, error }

class AgentResearchController extends ChangeNotifier {
  AgentResearchController(this._repository);

  final AgentResearchRepository _repository;

  List<AgentResearchJob> _jobs = [];
  AgentResearchStatus _status = AgentResearchStatus.idle;
  String? _error;
  Timer? _pollingTimer;

  List<AgentResearchJob> get jobs => List.unmodifiable(_jobs);
  AgentResearchStatus get status => _status;
  String? get error => _error;

  List<AgentResearchJob> get activeJobs =>
      _jobs.where((j) => j.isActive).toList();

  List<AgentResearchJob> get completedJobs =>
      _jobs.where((j) => j.status == 'done').toList();

  List<AgentResearchJob> get failedJobs =>
      _jobs.where((j) => j.status == 'error').toList();

  // --------------------------------------------------------------------------
  // Load
  // --------------------------------------------------------------------------

  Future<void> refresh() async {
    _status = AgentResearchStatus.loading;
    _error = null;
    notifyListeners();
    try {
      _jobs = await _repository.list();
      _status = AgentResearchStatus.idle;
    } catch (e) {
      _error = e.toString();
      _status = AgentResearchStatus.error;
    }
    notifyListeners();
  }

  // --------------------------------------------------------------------------
  // Create
  // --------------------------------------------------------------------------

  Future<AgentResearchJob?> create(Map<String, dynamic> input) async {
    try {
      final job = await _repository.create(input);
      _jobs = [job, ..._jobs];
      _error = null;
      notifyListeners();
      return job;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return null;
    }
  }

  Future<void> retry(String id) async {
    try {
      final job = await _repository.retry(id);
      _jobs = _jobs
          .map((existing) => existing.id == id ? job : existing)
          .toList();
      _error = null;
    } catch (e) {
      _error = e.toString();
    }
    notifyListeners();
  }

  // --------------------------------------------------------------------------
  // Polling
  // --------------------------------------------------------------------------

  Future<void> pollJob(String id) async {
    try {
      final updated = await _repository.get(id);
      _jobs = _jobs.map((j) => j.id == id ? updated : j).toList();
      notifyListeners();
    } catch (_) {
      // Silently ignore poll errors to avoid disrupting the UI
    }
  }

  void startPolling() {
    _pollingTimer?.cancel();
    _pollingTimer = Timer.periodic(const Duration(seconds: 3), (_) async {
      final active = activeJobs;
      for (final job in active) {
        await pollJob(job.id);
      }
    });
  }

  void stopPolling() {
    _pollingTimer?.cancel();
    _pollingTimer = null;
  }

  @override
  void dispose() {
    _pollingTimer?.cancel();
    super.dispose();
  }
}
