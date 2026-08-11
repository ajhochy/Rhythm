import '../../../app/core/utils/json_parsing.dart';

Map<String, dynamic> _map(dynamic value) =>
    value is Map<String, dynamic> ? value : <String, dynamic>{};
List<Map<String, dynamic>> _maps(dynamic value) => value is List
    ? value
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList()
    : <Map<String, dynamic>>[];

class ResearchProject {
  const ResearchProject(
      {required this.id,
      required this.name,
      required this.question,
      required this.goals,
      required this.domain,
      required this.profileId,
      required this.passConfig,
      required this.modelPolicy,
      required this.criticConfig,
      required this.synthesisConfig,
      required this.scheduleRef,
      required this.budget,
      required this.archivedAt});
  factory ResearchProject.fromJson(Map<String, dynamic> json) =>
      ResearchProject(
        id: asString(json['id']) ?? '',
        name: asString(json['name']) ?? '',
        question: asString(json['question']) ?? '',
        goals: (json['goals'] as List?)
                ?.map((value) => value.toString())
                .toList() ??
            const [],
        domain: asString(json['domain']),
        profileId: asString(json['profileId']),
        passConfig: _maps(json['passConfig']),
        modelPolicy: _map(json['modelPolicy']),
        criticConfig: _map(json['criticConfig']),
        synthesisConfig: _map(json['synthesisConfig']),
        scheduleRef: asString(json['scheduleRef']),
        budget: _map(json['budget']),
        archivedAt: asString(json['archivedAt']),
      );
  final String id, name, question;
  final List<String> goals;
  final String? domain, profileId, scheduleRef, archivedAt;
  final List<Map<String, dynamic>> passConfig;
  final Map<String, dynamic> modelPolicy, criticConfig, synthesisConfig, budget;
}

class ResearchUsage {
  const ResearchUsage(this.tokens, this.costUsd);
  factory ResearchUsage.fromJson(Map<String, dynamic> json) => ResearchUsage(
      asInt(json['tokens']) ?? 0, (json['costUsd'] as num?)?.toDouble() ?? 0);
  final int tokens;
  final double costUsd;
}

class ResearchStage {
  const ResearchStage(
      {required this.id,
      required this.role,
      required this.ordinal,
      required this.status,
      this.profileId,
      this.model,
      this.report});
  factory ResearchStage.fromJson(Map<String, dynamic> json) => ResearchStage(
      id: asString(json['id']) ?? '',
      role: asString(json['role']) ?? 'pass',
      ordinal: asInt(json['ordinal']) ?? 0,
      status: asString(json['status']) ?? 'pending',
      profileId: asString(json['profileId']),
      model: asString(json['model']),
      report: asString(json['report']));
  final String id, role, status;
  final int ordinal;
  final String? profileId, model, report;
  bool get isActive => const ['gathering', 'reading', 'synthesizing', 'running']
      .contains(status);
}

class ResearchProjectRun {
  const ResearchProjectRun(
      {required this.id,
      required this.projectId,
      required this.triggerType,
      required this.configSnapshot,
      required this.status,
      required this.progress,
      required this.diagnostics,
      required this.stages,
      required this.artifacts,
      required this.sources,
      required this.usage,
      this.startedAt,
      this.completedAt,
      this.canonicalArtifact});
  factory ResearchProjectRun.fromJson(Map<String, dynamic> json) {
    final progress = _map(json['progress']);
    return ResearchProjectRun(
        id: asString(json['id']) ?? '',
        projectId: asString(json['projectId']) ?? '',
        triggerType: asString(json['triggerType']) ?? 'manual',
        configSnapshot: _map(json['configSnapshot']),
        status: asString(json['status']) ?? 'pending',
        progress: progress,
        diagnostics: _map(json['diagnostics']),
        stages: _maps(progress['stages']).map(ResearchStage.fromJson).toList(),
        artifacts: _maps(json['artifacts']),
        sources: _maps(json['sources']),
        usage: ResearchUsage.fromJson(_map(json['usage'])),
        startedAt: asString(json['startedAt']),
        completedAt: asString(json['completedAt']),
        canonicalArtifact: json['canonicalArtifact'] is Map
            ? Map<String, dynamic>.from(json['canonicalArtifact'] as Map)
            : null);
  }
  final String id, projectId, triggerType, status;
  final Map<String, dynamic> configSnapshot, progress, diagnostics;
  final List<ResearchStage> stages;
  final List<Map<String, dynamic>> artifacts, sources;
  final ResearchUsage usage;
  final String? startedAt, completedAt;
  final Map<String, dynamic>? canonicalArtifact;
  double get progressPercent {
    final total = asInt(progress['totalJobs']) ?? stages.length;
    final complete = asInt(progress['completedJobs']) ??
        stages.where((stage) => stage.status == 'done').length;
    return total == 0 ? 0 : complete / total;
  }

  ResearchStage? get synthesis {
    for (final stage in stages.reversed) {
      if (stage.role == 'synthesis') return stage;
    }
    return null;
  }
}

class ResearchCapabilityWarning {
  const ResearchCapabilityWarning(this.agentId, this.warnings);
  factory ResearchCapabilityWarning.fromJson(Map<String, dynamic> json) {
    final warnings = <String>{
      ...?((json['warnings'] as List?)
          ?.map((value) => value.toString().trim())
          .where((value) => value.isNotEmpty)),
    };
    final channels = json['channels'];
    if (channels is Map) {
      for (final entry in channels.entries) {
        final diagnostic = entry.value;
        if (diagnostic is! Map || diagnostic['available'] == true) continue;
        final channel = _researchChannelLabel(entry.key.toString());
        final action = diagnostic['action']?.toString();
        final via = diagnostic['via']?.toString();
        final reason = diagnostic['reason']?.toString().trim();
        final detail = action == 'fallback' && via != null && via.isNotEmpty
            ? ' — using $via fallback'
            : reason != null && reason.isNotEmpty
                ? ': $reason'
                : '';
        warnings.add('$channel unavailable$detail');
      }
    }
    return ResearchCapabilityWarning(
        asString(json['agentId']) ?? 'research', warnings.toList());
  }
  final String agentId;
  final List<String> warnings;
}

String _researchChannelLabel(String channel) => switch (channel) {
      'x' => 'X',
      'youtube' => 'YouTube',
      'gmail' => 'Gmail',
      _ => channel.isEmpty
          ? 'Channel'
          : '${channel[0].toUpperCase()}${channel.substring(1)}',
    };
