import '../../../app/core/utils/json_parsing.dart';

class RecurringTaskRuleStep {
  RecurringTaskRuleStep({
    required this.id,
    required this.title,
    this.assigneeId,
    this.assigneeName,
  });

  factory RecurringTaskRuleStep.fromJson(Map<String, dynamic> json) {
    return RecurringTaskRuleStep(
      id: asString(json['id']) ?? '',
      title: asString(json['title']) ?? '',
      assigneeId: asInt(json['assigneeId']),
      assigneeName: asString(json['assigneeName']),
    );
  }

  final String id;
  final String title;
  final int? assigneeId;
  final String? assigneeName;

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'assigneeId': assigneeId,
      };
}

class RecurringTaskRuleProgress {
  RecurringTaskRuleProgress({
    required this.totalCount,
    required this.completedCount,
    required this.remainingCount,
    required this.personalRemainingCount,
    required this.waitingOnUserId,
    required this.waitingOnUserName,
    required this.nextDueDate,
    required this.completionRatio,
  });

  factory RecurringTaskRuleProgress.fromJson(Map<String, dynamic> json) {
    return RecurringTaskRuleProgress(
      totalCount: asInt(json['totalCount']) ?? 0,
      completedCount: asInt(json['completedCount']) ?? 0,
      remainingCount: asInt(json['remainingCount']) ?? 0,
      personalRemainingCount: asInt(json['personalRemainingCount']) ?? 0,
      waitingOnUserId: asInt(json['waitingOnUserId']),
      waitingOnUserName: asString(json['waitingOnUserName']),
      nextDueDate: asString(json['nextDueDate']),
      completionRatio: asDouble(json['completionRatio']) ?? 0,
    );
  }

  final int totalCount;
  final int completedCount;
  final int remainingCount;
  final int personalRemainingCount;
  final int? waitingOnUserId;
  final String? waitingOnUserName;
  final String? nextDueDate;
  final double completionRatio;
}

class RecurringTaskRule {
  RecurringTaskRule({
    required this.id,
    required this.title,
    required this.frequency,
    required this.createdAt,
    this.dayOfWeek,
    this.dayOfMonth,
    this.month,
    this.enabled = true,
    this.steps = const [],
    this.progress,
  });

  factory RecurringTaskRule.fromJson(Map<String, dynamic> json) {
    return RecurringTaskRule(
      id: asString(json['id']) ?? '',
      title: asString(json['title']) ?? '',
      frequency: asString(json['frequency']) ?? '',
      dayOfWeek: asInt(json['dayOfWeek']),
      dayOfMonth: asInt(json['dayOfMonth']),
      month: asInt(json['month']),
      createdAt: asString(json['createdAt']) ?? '',
      enabled: asBool(json['enabled']) ?? true,
      steps: ((json['steps'] as List<dynamic>?) ?? const [])
          .map((step) => RecurringTaskRuleStep.fromJson(
                step as Map<String, dynamic>,
              ))
          .toList(),
      progress: json['progress'] is Map<String, dynamic>
          ? RecurringTaskRuleProgress.fromJson(
              json['progress'] as Map<String, dynamic>,
            )
          : null,
    );
  }

  final String id;
  final String title;
  final String frequency; // 'weekly' | 'monthly' | 'annual'
  final int? dayOfWeek; // 0=Sun..6=Sat (weekly)
  final int? dayOfMonth; // 1-31 (monthly / annual)
  final int? month; // 1-12 (annual)
  final bool enabled;
  final String createdAt;
  final List<RecurringTaskRuleStep> steps;
  final RecurringTaskRuleProgress? progress;

  RecurringTaskRule copyWith({bool? enabled}) {
    return RecurringTaskRule(
      id: id,
      title: title,
      frequency: frequency,
      dayOfWeek: dayOfWeek,
      dayOfMonth: dayOfMonth,
      month: month,
      createdAt: createdAt,
      enabled: enabled ?? this.enabled,
      steps: steps,
      progress: progress,
    );
  }

  bool get hasWorkflowSteps => steps.isNotEmpty;
  double get completionFraction => progress?.completionRatio ?? 0;
  int get remainingCount => progress?.remainingCount ?? 0;
  int get personalRemainingCount => progress?.personalRemainingCount ?? 0;
  String? get waitingOnUserName => progress?.waitingOnUserName;
  String? get nextDueDate => progress?.nextDueDate;

  String get patternDescription {
    switch (frequency) {
      case 'weekly':
        final days = [
          'Sunday',
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday'
        ];
        final dow = dayOfWeek ?? 1;
        return 'Every ${days[dow.clamp(0, 6)]}';
      case 'monthly':
        final d = dayOfMonth ?? 1;
        return 'Monthly on the ${_ordinal(d)}';
      case 'annual':
        final months = [
          '',
          'January',
          'February',
          'March',
          'April',
          'May',
          'June',
          'July',
          'August',
          'September',
          'October',
          'November',
          'December'
        ];
        final m = month ?? 1;
        final d = dayOfMonth ?? 1;
        return 'Every ${months[m.clamp(1, 12)]} ${_ordinal(d)}';
      default:
        return frequency;
    }
  }

  static String _ordinal(int n) {
    if (n >= 11 && n <= 13) return '${n}th';
    switch (n % 10) {
      case 1:
        return '${n}st';
      case 2:
        return '${n}nd';
      case 3:
        return '${n}rd';
      default:
        return '${n}th';
    }
  }
}
