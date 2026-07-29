/// Model for a single background loop's status.
class BackgroundLoopStatus {
  const BackgroundLoopStatus({
    required this.name,
    required this.state,
    required this.lastRunAt,
    required this.nextRunAt,
    this.currentItem,
  });

  factory BackgroundLoopStatus.fromJson(Map<String, dynamic> json) {
    return BackgroundLoopStatus(
      name: json['name'] as String,
      state: json['state'] as String,
      lastRunAt: json['lastRunAt'] as String?,
      nextRunAt: json['nextRunAt'] as String?,
      currentItem: json['currentItem'] as String?,
    );
  }

  /// Loop identifier (e.g. 'skill_harvester', 'memory', 'scheduler').
  final String name;

  /// 'idle' or 'running'.
  final String state;

  final String? lastRunAt;
  final String? nextRunAt;
  final String? currentItem;

  bool get isRunning => state == 'running';

  /// Human-readable display name for the UI.
  String get displayName {
    switch (name) {
      case 'skill_harvester':
        return 'Skill harvester';
      case 'skill_improver':
        return 'Skill improver';
      case 'memory':
        return 'Memory consolidation';
      case 'scheduler':
        return 'Scheduled tasks';
      case 'integrations_sync':
        return 'Integrations sync';
      default:
        return name;
    }
  }
}

/// Aggregated response from GET /agent-sessions/background-status.
class BackgroundStatus {
  const BackgroundStatus({required this.loops, required this.activeCount});

  factory BackgroundStatus.fromJson(Map<String, dynamic> json) {
    final rawLoops = json['loops'] as List<dynamic>? ?? [];
    return BackgroundStatus(
      loops: rawLoops
          .map((e) => BackgroundLoopStatus.fromJson(e as Map<String, dynamic>))
          .toList(),
      activeCount: (json['activeCount'] as num?)?.toInt() ?? 0,
    );
  }

  final List<BackgroundLoopStatus> loops;

  /// Number of loops currently in 'running' state.
  final int activeCount;

  bool get hasActivity => activeCount > 0;
}
