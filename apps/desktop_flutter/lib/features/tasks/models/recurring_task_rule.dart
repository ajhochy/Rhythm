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
  });

  factory RecurringTaskRule.fromJson(Map<String, dynamic> json) {
    return RecurringTaskRule(
      id: json['id'] as String,
      title: json['title'] as String,
      frequency: json['frequency'] as String,
      dayOfWeek: json['dayOfWeek'] as int?,
      dayOfMonth: json['dayOfMonth'] as int?,
      month: json['month'] as int?,
      createdAt: json['createdAt'] as String,
      enabled: (json['enabled'] as bool?) ?? true,
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
