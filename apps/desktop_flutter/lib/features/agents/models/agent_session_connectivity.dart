class AgentSessionConnectivity {
  const AgentSessionConnectivity({
    this.isWsDisconnected = false,
    this.stuckSessionIds = const <String>{},
  });

  final bool isWsDisconnected;
  final Set<String> stuckSessionIds;

  bool isStuck(String sessionId) => stuckSessionIds.contains(sessionId);

  AgentSessionConnectivity copyWith({
    bool? isWsDisconnected,
    Set<String>? stuckSessionIds,
  }) {
    return AgentSessionConnectivity(
      isWsDisconnected: isWsDisconnected ?? this.isWsDisconnected,
      stuckSessionIds: stuckSessionIds ?? this.stuckSessionIds,
    );
  }
}
