abstract class DashboardProgressItem {
  String get id;
  String get title;
  String get subtitle;
  int get completedCount;
  int get totalCount;
  double get progress;
  String? get nextDueDate;
}

class DashboardRhythmProgress implements DashboardProgressItem {
  DashboardRhythmProgress({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.completedCount,
    required this.totalCount,
    this.nextDueDate,
  });

  @override
  final String id;
  @override
  final String title;
  @override
  final String subtitle;
  @override
  final int completedCount;
  @override
  final int totalCount;
  @override
  final String? nextDueDate;

  @override
  double get progress =>
      totalCount == 0 ? 0 : completedCount.clamp(0, totalCount) / totalCount;
}

class DashboardProjectProgress implements DashboardProgressItem {
  DashboardProjectProgress({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.completedCount,
    required this.totalCount,
    this.nextDueDate,
  });

  @override
  final String id;
  @override
  final String title;
  @override
  final String subtitle;
  @override
  final int completedCount;
  @override
  final int totalCount;
  @override
  final String? nextDueDate;

  @override
  double get progress =>
      totalCount == 0 ? 0 : completedCount.clamp(0, totalCount) / totalCount;
}

class DashboardUnreadMessagePreview {
  DashboardUnreadMessagePreview({
    required this.threadId,
    required this.threadTitle,
    required this.senderName,
    required this.preview,
    required this.updatedAt,
    required this.unreadCount,
  });

  final int threadId;
  final String threadTitle;
  final String senderName;
  final String preview;
  final DateTime updatedAt;
  final int unreadCount;
}
