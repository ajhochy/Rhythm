class DateFormatters {
  static const _weekdayNames = <String>[
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ];

  static const _monthNames = <String>[
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
    'December',
  ];

  static String fullDate(String? isoDate, {String fallback = 'No date'}) {
    final parsed = _parseIsoDate(isoDate);
    if (parsed == null) return fallback;
    return fullDateFromDateTime(parsed);
  }

  static String fullDateFromDateTime(DateTime value) {
    final date = DateTime(value.year, value.month, value.day);
    final weekday = _weekdayNames[date.weekday - 1];
    final month = _monthNames[date.month - 1];
    return '$weekday, $month ${date.day}, ${date.year}';
  }

  static bool isPastDue({
    required String? dueDate,
    required String? scheduledDate,
    required bool isDone,
    DateTime? today,
  }) {
    if (isDone) return false;
    final comparisonDate =
        _parseIsoDate(scheduledDate) ?? _parseIsoDate(dueDate);
    if (comparisonDate == null) return false;
    final current = today == null
        ? DateTime.now()
        : DateTime(today.year, today.month, today.day);
    return comparisonDate.isBefore(
      DateTime(current.year, current.month, current.day),
    );
  }

  static bool isDueToday({
    required String? dueDate,
    required String? scheduledDate,
    required bool isDone,
    DateTime? today,
  }) {
    if (isDone) return false;
    final comparisonDate =
        _parseIsoDate(scheduledDate) ?? _parseIsoDate(dueDate);
    if (comparisonDate == null) return false;
    final current = today == null
        ? DateTime.now()
        : DateTime(today.year, today.month, today.day);
    return comparisonDate.year == current.year &&
        comparisonDate.month == current.month &&
        comparisonDate.day == current.day;
  }

  static DateTime? _parseIsoDate(String? value) {
    if (value == null || value.trim().isEmpty) return null;
    final match = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(value.trim());
    if (match == null) return null;
    final year = int.tryParse(match.group(1)!);
    final month = int.tryParse(match.group(2)!);
    final day = int.tryParse(match.group(3)!);
    if (year == null || month == null || day == null) return null;
    return DateTime(year, month, day);
  }
}
