import 'dart:convert';

import '../../../app/core/utils/json_parsing.dart';

/// A single proposed org-optimizer change awaiting human review.
///
/// Mirrors `AgentOrgProposal` on the server (org-optimizer-01, #817) and the
/// review-queue API (org-optimizer-10, #826). Per the 2026-07-02 policy
/// update, the review queue is the EXCEPTION path — only `create-agent` and
/// `external-adoption`/`webhook-wiring` proposals realistically ever sit in
/// `status == 'proposed'`; most proposals flow through the auto-apply lane
/// and never reach this screen.
class OrgProposal {
  OrgProposal({
    required this.id,
    this.auditRunId,
    required this.kind,
    required this.risk,
    required this.external,
    required this.status,
    required this.title,
    this.rationale,
    this.signalRef,
    this.targetRef,
    this.changeJson,
    this.beforeSnapshotJson,
    this.provenanceJson,
    this.dedupKey,
    this.baselineScore,
    this.postScore,
    this.measureReason,
    this.decidedByUserId,
    required this.createdAt,
    required this.updatedAt,
  });

  factory OrgProposal.fromJson(Map<String, dynamic> json) {
    return OrgProposal(
      id: asString(json['id']) ?? '',
      auditRunId: asString(json['auditRunId']),
      kind: asString(json['kind']) ?? '',
      risk: asString(json['risk']) ?? 'high',
      external: asInt(json['external']) ?? 0,
      status: asString(json['status']) ?? 'proposed',
      title: asString(json['title']) ?? '',
      rationale: asString(json['rationale']),
      signalRef: asString(json['signalRef']),
      targetRef: asString(json['targetRef']),
      changeJson: asString(json['changeJson']),
      beforeSnapshotJson: asString(json['beforeSnapshotJson']),
      provenanceJson: asString(json['provenanceJson']),
      dedupKey: asString(json['dedupKey']),
      baselineScore: asInt(json['baselineScore']),
      postScore: asInt(json['postScore']),
      measureReason: asString(json['measureReason']),
      decidedByUserId: asInt(json['decidedByUserId']),
      createdAt: asString(json['createdAt']) ?? '',
      updatedAt: asString(json['updatedAt']) ?? '',
    );
  }

  final String id;
  final String? auditRunId;
  final String kind;
  final String risk;
  final int external;
  final String status;
  final String title;
  final String? rationale;
  final String? signalRef;
  final String? targetRef;
  final String? changeJson;
  final String? beforeSnapshotJson;
  final String? provenanceJson;
  final String? dedupKey;
  final int? baselineScore;
  final int? postScore;
  final String? measureReason;
  final int? decidedByUserId;
  final String createdAt;
  final String updatedAt;

  bool get isExternal => external != 0;

  /// True for the two kinds that require a mandatory provenance/security
  /// note before Approve is permitted (server-enforced in #826; this is a
  /// UX mirror, not the real gate).
  bool get requiresSecurityNote =>
      kind == 'external-adoption' || kind == 'webhook-wiring';

  /// Parses [provenanceJson] into a map, or null if absent/blank/invalid.
  Map<String, dynamic>? get provenance {
    final raw = provenanceJson;
    if (raw == null || raw.trim().isEmpty) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic> && decoded.isNotEmpty) {
        return decoded;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// True iff a non-empty provenance/security note is present. Mirrors the
  /// server's `hasSecurityNote` predicate (org_proposal_apply_service.ts) —
  /// used to disable the Approve button until the note exists.
  bool get hasSecurityNote => provenance != null;

  /// Parses [beforeSnapshotJson] into a map, or null if absent/invalid.
  Map<String, dynamic>? get beforeSnapshot {
    final raw = beforeSnapshotJson;
    if (raw == null || raw.trim().isEmpty) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) return decoded;
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Parses [changeJson] into a map, or null if absent/invalid.
  Map<String, dynamic>? get change {
    final raw = changeJson;
    if (raw == null || raw.trim().isEmpty) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) return decoded;
      return null;
    } catch (_) {
      return null;
    }
  }
}
