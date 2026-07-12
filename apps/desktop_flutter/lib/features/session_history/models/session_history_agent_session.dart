/// #1027 (USO A4) — the standalone Session History LIST was retired; only the
/// transcript-detail view survives (reused by the Agents session detail). This
/// file now carries just the status enum that the detail view renders with.
enum SessionHistoryStatus {
  running,
  completed,
  failed;

  static SessionHistoryStatus fromWire(String? value) {
    switch (value) {
      case 'starting':
      case 'working':
      case 'idle':
      case 'resumable':
        return SessionHistoryStatus.running;
      case 'error':
        return SessionHistoryStatus.failed;
      case 'closed':
      default:
        return SessionHistoryStatus.completed;
    }
  }

  String get label {
    switch (this) {
      case SessionHistoryStatus.running:
        return 'Running';
      case SessionHistoryStatus.completed:
        return 'Completed';
      case SessionHistoryStatus.failed:
        return 'Failed';
    }
  }
}
