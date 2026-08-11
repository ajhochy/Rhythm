import 'dart:convert';

import 'agent_session_message.dart';

/// One successful Live Artifact mutation found in a persisted transcript.
class TranscriptArtifactReference {
  const TranscriptArtifactReference({
    required this.artifactId,
    required this.messageId,
    required this.mutatedAt,
    required this.toolName,
    required this.partIndex,
  });

  final String artifactId;
  final int messageId;
  final DateTime mutatedAt;
  final String toolName;
  final int partIndex;
}

const _argumentMutationTools = <String>{
  'rhythm_update_live_artifact_state',
  'rhythm_update_live_artifact_bundle',
  'rhythm_update_live_artifact_sharing',
};

final _artifactIdPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  caseSensitive: false,
);

/// Extracts only completed mutations belonging to [sessionId].
///
/// Results are unique by stable artifact ID and newest mutation first. Create
/// IDs come from the successful JSON output; update IDs come from tool input.
List<TranscriptArtifactReference> extractTranscriptArtifactReferences({
  required String sessionId,
  required Iterable<AgentSessionMessage> messages,
}) {
  final candidates = <({TranscriptArtifactReference reference, int part})>[];

  for (final message in messages) {
    if (message.sessionId != sessionId) continue;
    final parts = message.parts ?? const <Map<String, dynamic>>[];
    for (var partIndex = 0; partIndex < parts.length; partIndex++) {
      final part = parts[partIndex];
      if (part['type'] != 'tool') continue;
      final toolName = part['tool'];
      final state = part['state'];
      if (toolName is! String || state is! Map<String, dynamic>) continue;
      if (state['status'] != 'completed') continue;

      final artifactId = switch (toolName) {
        'rhythm_create_live_artifact' => _createArtifactId(state['output']),
        _ when _argumentMutationTools.contains(toolName) =>
          _validArtifactId((state['input'] as Map?)?['id']),
        _ => null,
      };
      if (artifactId == null) continue;

      candidates.add((
        reference: TranscriptArtifactReference(
          artifactId: artifactId,
          messageId: message.id,
          mutatedAt: message.createdAt,
          toolName: toolName,
          partIndex: partIndex,
        ),
        part: partIndex,
      ));
    }
  }

  candidates.sort((left, right) {
    final byTime = right.reference.mutatedAt.compareTo(
      left.reference.mutatedAt,
    );
    if (byTime != 0) return byTime;
    final byMessage = right.reference.messageId.compareTo(
      left.reference.messageId,
    );
    if (byMessage != 0) return byMessage;
    return right.part.compareTo(left.part);
  });

  final seen = <String>{};
  return [
    for (final candidate in candidates)
      if (seen.add(candidate.reference.artifactId)) candidate.reference,
  ];
}

String? _createArtifactId(Object? output) {
  if (output is! String || output.isEmpty) return null;
  try {
    final decoded = jsonDecode(output);
    if (decoded is! Map<String, dynamic>) return null;
    return _validArtifactId(decoded['id']);
  } on FormatException {
    return null;
  }
}

String? _validArtifactId(Object? value) {
  if (value is! String || !_artifactIdPattern.hasMatch(value)) return null;
  return value;
}
