import 'dart:convert';

import '../../../app/core/utils/json_parsing.dart';

class AgentResearchJob {
  AgentResearchJob({
    required this.id,
    required this.query,
    required this.status,
    required this.sources,
    this.report,
    this.error,
    this.researchType = 'generic',
    this.title,
    this.agentProfileId,
    this.agentSessionId,
    this.vaultPath,
    this.canRetry = false,
    this.requestedByUserId,
    required this.createdAt,
    required this.updatedAt,
  });

  factory AgentResearchJob.fromJson(Map<String, dynamic> json) {
    List<String> parseSources(dynamic v) {
      if (v == null) return [];
      if (v is List) return v.map((e) => e.toString()).toList();
      if (v is String && v.isNotEmpty) {
        try {
          final d = jsonDecode(v);
          if (d is List) return d.map((e) => e.toString()).toList();
        } catch (_) {}
      }
      return [];
    }

    return AgentResearchJob(
      id: asString(json['id']) ?? '',
      query: asString(json['query']) ?? '',
      status: asString(json['status']) ?? 'pending',
      sources: parseSources(json['sourcesJson'] ?? json['sources']),
      report: asString(json['report']),
      error: asString(json['error']),
      researchType: asString(json['researchType']) ?? 'generic',
      title: asString(json['title']),
      agentProfileId: asString(json['agentProfileId']),
      agentSessionId: asString(json['agentSessionId']),
      vaultPath: asString(json['vaultPath']),
      canRetry: json['canRetry'] == true,
      requestedByUserId: asInt(json['requestedByUserId']),
      createdAt: asString(json['createdAt']) ?? '',
      updatedAt: asString(json['updatedAt']) ?? '',
    );
  }

  final String id;
  final String query;
  final String status;
  final List<String> sources;
  final String? report;
  final String? error;
  final String researchType;
  final String? title;
  final String? agentProfileId;
  final String? agentSessionId;
  final String? vaultPath;
  final bool canRetry;
  final int? requestedByUserId;
  final String createdAt;
  final String updatedAt;

  bool get isComplete => status == 'done' || status == 'error';
  bool get isActive => !isComplete;
  String get displayTitle => title?.trim().isNotEmpty == true ? title! : query;
  String get typeLabel => switch (researchType) {
        'ai-trends' => 'AI Trends',
        'theological' => 'Theological',
        _ => 'Research',
      };

  String get statusLabel => switch (status) {
        'pending' => 'Queued',
        'gathering' => 'Gathering sources…',
        'reading' => 'Reading sources…',
        'synthesizing' => 'Synthesizing…',
        'done' => 'Complete',
        'error' => 'Failed',
        _ => status,
      };
}
