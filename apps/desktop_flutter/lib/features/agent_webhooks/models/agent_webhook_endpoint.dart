import 'dart:convert';

import '../../../app/core/utils/json_parsing.dart';

class AgentWebhookEndpoint {
  AgentWebhookEndpoint({
    required this.id,
    required this.name,
    required this.eventTypes,
    required this.secret,
    this.targetScheduledTaskId,
    this.targetPrompt,
    required this.enabled,
    this.lastTriggeredAt,
    required this.triggerCount,
    required this.createdByUserId,
    required this.createdAt,
    required this.updatedAt,
  });

  factory AgentWebhookEndpoint.fromJson(Map<String, dynamic> json) {
    return AgentWebhookEndpoint(
      id: asString(json['id']) ?? '',
      name: asString(json['name']) ?? '',
      eventTypes: _parseStringList(json['eventTypesJson']),
      secret: asString(json['secret']) ?? '',
      targetScheduledTaskId: asString(json['targetScheduledTaskId']),
      targetPrompt: asString(json['targetPrompt']),
      enabled: asBool(json['enabled']) ?? true,
      lastTriggeredAt: asString(json['lastTriggeredAt']),
      triggerCount: asInt(json['triggerCount']) ?? 0,
      createdByUserId: asString(json['createdByUserId']) ?? '',
      createdAt: asString(json['createdAt']) ?? '',
      updatedAt: asString(json['updatedAt']) ?? '',
    );
  }

  static List<String> _parseStringList(dynamic value) {
    if (value == null) return [];
    if (value is List) return value.map((e) => e.toString()).toList();
    if (value is String && value.isNotEmpty) {
      try {
        final decoded = jsonDecode(value);
        if (decoded is List) return decoded.map((e) => e.toString()).toList();
      } catch (_) {}
    }
    return [];
  }

  final String id;
  final String name;
  final List<String> eventTypes;
  final String secret;
  final String? targetScheduledTaskId;
  final String? targetPrompt;
  final bool enabled;
  final String? lastTriggeredAt;
  final int triggerCount;
  final String createdByUserId;
  final String createdAt;
  final String updatedAt;

  String get receiveUrl => 'http://localhost:4001/agent-webhooks/$id/receive';
}
