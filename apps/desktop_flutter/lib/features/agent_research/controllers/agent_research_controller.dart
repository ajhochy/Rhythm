import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/agent_research_job.dart';
import '../models/research_project.dart';
import '../repositories/agent_research_repository.dart';
import '../../../app/core/errors/app_error.dart';

enum AgentResearchStatus { idle, loading, error }

class AgentResearchController extends ChangeNotifier {
  AgentResearchController(this._repository);

  final AgentResearchRepository _repository;

  List<AgentResearchJob> _jobs = [];
  AgentResearchStatus _status = AgentResearchStatus.idle;
  String? _error;
  Timer? _pollingTimer;
  bool _projectsAvailable = false;
  List<ResearchProject> _projects = [];
  List<ResearchCapabilityWarning> _capabilities = [];
  ResearchProject? _selectedProject;
  List<ResearchProjectRun> _runs = [];
  ResearchProjectRun? _selectedRun;

  List<AgentResearchJob> get jobs => List.unmodifiable(_jobs);
  AgentResearchStatus get status => _status;
  String? get error => _error;
  bool get projectsAvailable => _projectsAvailable;
  List<ResearchProject> get projects => List.unmodifiable(_projects);
  List<ResearchCapabilityWarning> get capabilities =>
      List.unmodifiable(_capabilities);
  ResearchProject? get selectedProject => _selectedProject;
  List<ResearchProjectRun> get runs => List.unmodifiable(_runs);
  ResearchProjectRun? get selectedRun => _selectedRun;

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
      try {
        _projects = await _repository.listProjects();
        _projectsAvailable = true;
        if (_projects.isNotEmpty && _selectedProject == null) {
          _selectedProject = _projects.first;
          _runs = await _repository.listProjectRuns(_selectedProject!.id);
          if (_runs.isNotEmpty) _selectedRun = _runs.first;
        }
        try {
          _capabilities = await _repository.researchCapabilities();
        } catch (_) {
          _capabilities = [];
        }
        try {
          _jobs = await _repository.list();
        } catch (_) {
          // Legacy history is supplementary while Projects is available; a
          // malformed or unavailable legacy response must not hide Projects.
          _jobs = [];
        }
      } on AppError catch (e) {
        if (e.statusCode != 404) rethrow;
        _projectsAvailable = false;
        _projects = [];
        _jobs = await _repository.list();
      }
      _status = AgentResearchStatus.idle;
    } catch (e) {
      _error = e.toString();
      _status = AgentResearchStatus.error;
    }
    notifyListeners();
  }

  Future<void> selectProject(ResearchProject project) async {
    _selectedProject = project;
    _selectedRun = null;
    _runs = [];
    notifyListeners();
    try {
      _runs = await _repository.listProjectRuns(project.id);
      if (_runs.isNotEmpty) _selectedRun = _runs.first;
      _error = null;
    } catch (e) {
      _error = e.toString();
    }
    notifyListeners();
  }

  void clearProjectSelection() {
    _selectedProject = null;
    _selectedRun = null;
    _runs = [];
    notifyListeners();
  }

  Future<ResearchProject?> createProject(Map<String, dynamic> input) async {
    try {
      final project = await _repository.createProject(input);
      _projects = [project, ..._projects];
      await selectProject(project);
      return project;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return null;
    }
  }

  Future<bool> updateProject(String id, Map<String, dynamic> input) async {
    try {
      final project = await _repository.updateProject(id, input);
      _projects =
          _projects.map((item) => item.id == id ? project : item).toList();
      if (_selectedProject?.id == id) _selectedProject = project;
      _error = null;
      notifyListeners();
      return true;
    } catch (e) {
      _error = e.toString();
    }
    notifyListeners();
    return false;
  }

  Future<bool> archiveProject(String id) async {
    try {
      await _repository.archiveProject(id);
      _projects = _projects.where((project) => project.id != id).toList();
      if (_selectedProject?.id == id) {
        _selectedProject = null;
        _selectedRun = null;
        _runs = [];
      }
      _error = null;
      notifyListeners();
      return true;
    } catch (e) {
      _error = e.toString();
    }
    notifyListeners();
    return false;
  }

  Future<void> startProjectRun() async {
    final project = _selectedProject;
    if (project == null) return;
    try {
      final run = await _repository.startProjectRun(project.id);
      _runs = [run, ..._runs.where((item) => item.id != run.id)];
      _selectedRun = run;
      _error = null;
    } catch (e) {
      _error = e.toString();
    }
    notifyListeners();
  }

  Future<void> selectRun(ResearchProjectRun run) async {
    final project = _selectedProject;
    if (project == null) return;
    _selectedRun = await _repository.getProjectRun(project.id, run.id);
    notifyListeners();
  }

  Future<void> runAction(String action) async {
    final project = _selectedProject;
    final run = _selectedRun;
    if (project == null || run == null) return;
    try {
      _selectedRun = await _repository.runAction(project.id, run.id, action);
      _error = null;
    } catch (e) {
      _error = e.toString();
    }
    notifyListeners();
  }

  Future<void> passAction(ResearchStage stage, String action) async {
    final project = _selectedProject;
    final run = _selectedRun;
    if (project == null || run == null) return;
    try {
      await _repository.passAction(project.id, run.id, stage.id, action);
      _selectedRun = await _repository.getProjectRun(project.id, run.id);
      _error = null;
    } catch (e) {
      _error = e.toString();
    }
    notifyListeners();
  }

  Uri? magazineUri() {
    final project = _selectedProject;
    final run = _selectedRun;
    return project == null || run == null
        ? null
        : _repository.magazineUri(project.id, run.id);
  }

  Uri? exportUri(String format) {
    final project = _selectedProject;
    final run = _selectedRun;
    return project == null || run == null
        ? null
        : _repository.exportUri(project.id, run.id, format);
  }

  Future<String?> startDiscussion(List<String> artifactIds) async {
    final project = _selectedProject;
    final run = _selectedRun;
    if (project == null || run == null) return null;
    try {
      final sessionId =
          await _repository.startDiscussion(project.id, run.id, artifactIds);
      _error = null;
      notifyListeners();
      return sessionId;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return null;
    }
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
      _jobs =
          _jobs.map((existing) => existing.id == id ? job : existing).toList();
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
      final project = _selectedProject;
      final run = _selectedRun;
      if (project != null &&
          run != null &&
          !_terminalRunStates.contains(run.status)) {
        try {
          _selectedRun = await _repository.getProjectRun(project.id, run.id);
          notifyListeners();
        } catch (_) {}
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

const _terminalRunStates = {
  'complete',
  'passes_complete',
  'budget_exhausted',
  'cancelled',
  'error',
  'degraded',
};
