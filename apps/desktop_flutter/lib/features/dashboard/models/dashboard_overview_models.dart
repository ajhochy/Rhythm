import '../../tasks/models/task.dart';

class DashboardSummaryTaskSlice {
  DashboardSummaryTaskSlice({
    required this.openCount,
    required this.pastDueCount,
    required this.todayRemainingCount,
    required this.todayTotalCount,
    required this.thisWeekRemainingCount,
    required this.thisWeekTotalCount,
    required this.unscheduledCount,
    required this.recent,
    required this.pastDue,
    required this.today,
    required this.thisWeek,
    required this.unscheduled,
  });

  factory DashboardSummaryTaskSlice.fromJson(Map<String, dynamic> json) {
    List<Task> parseList(String key) => ((json[key] as List<dynamic>?) ?? [])
        .map((j) => Task.fromJson(j as Map<String, dynamic>))
        .toList();
    return DashboardSummaryTaskSlice(
      openCount: (json['openCount'] as num?)?.toInt() ?? 0,
      pastDueCount: (json['pastDueCount'] as num?)?.toInt() ?? 0,
      todayRemainingCount: (json['todayRemainingCount'] as num?)?.toInt() ?? 0,
      todayTotalCount: (json['todayTotalCount'] as num?)?.toInt() ?? 0,
      thisWeekRemainingCount:
          (json['thisWeekRemainingCount'] as num?)?.toInt() ?? 0,
      thisWeekTotalCount: (json['thisWeekTotalCount'] as num?)?.toInt() ?? 0,
      unscheduledCount: (json['unscheduledCount'] as num?)?.toInt() ?? 0,
      recent: parseList('recent'),
      pastDue: parseList('pastDue'),
      today: parseList('today'),
      thisWeek: parseList('thisWeek'),
      unscheduled: parseList('unscheduled'),
    );
  }

  final int openCount;
  final int pastDueCount;
  final int todayRemainingCount;
  final int todayTotalCount;
  final int thisWeekRemainingCount;
  final int thisWeekTotalCount;
  final int unscheduledCount;
  final List<Task> recent;
  final List<Task> pastDue;
  final List<Task> today;
  final List<Task> thisWeek;
  final List<Task> unscheduled;
}

class DashboardSummaryMessageSlice {
  DashboardSummaryMessageSlice({
    required this.threadCount,
    required this.unreadPreviews,
  });

  factory DashboardSummaryMessageSlice.fromJson(Map<String, dynamic> json) {
    final rawPreviews = (json['unreadPreviews'] as List<dynamic>?) ?? [];
    return DashboardSummaryMessageSlice(
      threadCount: (json['threadCount'] as num?)?.toInt() ?? 0,
      unreadPreviews: rawPreviews
          .map((j) => DashboardUnreadMessagePreview.fromJson(
                j as Map<String, dynamic>,
              ))
          .toList(),
    );
  }

  final int threadCount;
  final List<DashboardUnreadMessagePreview> unreadPreviews;
}

class DashboardSummary {
  DashboardSummary({
    required this.tasks,
    required this.rhythms,
    required this.projects,
    required this.messages,
  });

  factory DashboardSummary.fromJson(Map<String, dynamic> json) {
    List<DashboardRhythmProgress> parseRhythms() {
      final raw = (json['rhythms'] as Map<String, dynamic>?)?['items'];
      if (raw == null) return [];
      return (raw as List<dynamic>)
          .map((j) =>
              DashboardRhythmProgress.fromJson(j as Map<String, dynamic>))
          .toList();
    }

    List<DashboardProjectProgress> parseProjects() {
      final raw = (json['projects'] as Map<String, dynamic>?)?['items'];
      if (raw == null) return [];
      return (raw as List<dynamic>)
          .map((j) =>
              DashboardProjectProgress.fromJson(j as Map<String, dynamic>))
          .toList();
    }

    return DashboardSummary(
      tasks: DashboardSummaryTaskSlice.fromJson(
        (json['tasks'] as Map<String, dynamic>?) ?? {},
      ),
      rhythms: parseRhythms(),
      projects: parseProjects(),
      messages: DashboardSummaryMessageSlice.fromJson(
        (json['messages'] as Map<String, dynamic>?) ?? {},
      ),
    );
  }

  final DashboardSummaryTaskSlice tasks;
  final List<DashboardRhythmProgress> rhythms;
  final List<DashboardProjectProgress> projects;
  final DashboardSummaryMessageSlice messages;
}

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

  factory DashboardRhythmProgress.fromJson(Map<String, dynamic> json) =>
      DashboardRhythmProgress(
        id: json['id'] as String,
        title: json['title'] as String,
        subtitle: json['subtitle'] as String? ?? '',
        completedCount: (json['completedCount'] as num?)?.toInt() ?? 0,
        totalCount: (json['totalCount'] as num?)?.toInt() ?? 0,
      );

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

  factory DashboardProjectProgress.fromJson(Map<String, dynamic> json) =>
      DashboardProjectProgress(
        id: json['id'] as String,
        title: json['title'] as String,
        subtitle: json['subtitle'] as String? ?? '',
        completedCount: (json['completedCount'] as num?)?.toInt() ?? 0,
        totalCount: (json['totalCount'] as num?)?.toInt() ?? 0,
        nextDueDate: json['nextDueDate'] as String?,
      );

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

  factory DashboardUnreadMessagePreview.fromJson(Map<String, dynamic> json) =>
      DashboardUnreadMessagePreview(
        threadId: (json['threadId'] as num).toInt(),
        threadTitle: json['threadTitle'] as String? ?? '',
        senderName: json['senderName'] as String? ?? '',
        preview: json['preview'] as String? ?? '',
        updatedAt: DateTime.tryParse(json['updatedAt'] as String? ?? '') ??
            DateTime.now(),
        unreadCount: (json['unreadCount'] as num?)?.toInt() ?? 0,
      );

  final int threadId;
  final String threadTitle;
  final String senderName;
  final String preview;
  final DateTime updatedAt;
  final int unreadCount;
}
