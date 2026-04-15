class GoogleCalendarOption {
  GoogleCalendarOption({
    required this.id,
    required this.name,
    required this.isPrimary,
    required this.isSelected,
  });

  factory GoogleCalendarOption.fromJson(Map<String, dynamic> json) {
    return GoogleCalendarOption(
      id: json['id'] as String,
      name: json['name'] as String,
      isPrimary: json['isPrimary'] as bool? ?? false,
      isSelected: json['isSelected'] as bool? ?? false,
    );
  }

  final String id;
  final String name;
  final bool isPrimary;
  final bool isSelected;
}

class GoogleCalendarSettings {
  GoogleCalendarSettings({
    required this.calendars,
    required this.selectedCalendarIds,
  });

  factory GoogleCalendarSettings.fromJson(Map<String, dynamic> json) {
    return GoogleCalendarSettings(
      calendars: (json['calendars'] as List<dynamic>? ?? const [])
          .map(
            (item) =>
                GoogleCalendarOption.fromJson(item as Map<String, dynamic>),
          )
          .toList(),
      selectedCalendarIds:
          (json['selectedCalendarIds'] as List<dynamic>? ?? const [])
              .map((item) => item.toString())
              .toList(),
    );
  }

  final List<GoogleCalendarOption> calendars;
  final List<String> selectedCalendarIds;
}
