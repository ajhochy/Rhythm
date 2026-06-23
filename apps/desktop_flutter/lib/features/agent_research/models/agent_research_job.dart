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
  final int? requestedByUserId;
  final String createdAt;
  final String updatedAt;

  bool get isComplete => status == 'done' || status == 'error';
  bool get isActive => !isComplete;

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
