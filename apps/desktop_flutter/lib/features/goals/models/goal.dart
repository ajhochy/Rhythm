import '../../../app/core/utils/json_parsing.dart';

class Goal {
  const Goal({
    required this.id,
    required this.title,
    required this.metricType,
    required this.startValue,
    required this.currentValue,
    required this.endValue,
    required this.health,
    required this.createdAt,
    required this.updatedAt,
    this.description,
    this.startDate,
    this.endDate,
  });

  factory Goal.fromJson(Map<String, dynamic> json) => Goal(
        id: asString(json['id']) ?? '',
        title: asString(json['title']) ?? '',
        description: asString(json['description']),
        metricType: asString(json['metricType']) ?? 'number',
        startValue: (json['startValue'] as num?)?.toDouble() ?? 0,
        currentValue: (json['currentValue'] as num?)?.toDouble() ?? 0,
        endValue: (json['endValue'] as num?)?.toDouble() ?? 1,
        health: asString(json['health']) ?? 'on_track',
        startDate: asString(json['startDate']),
        endDate: asString(json['endDate']),
        createdAt: asString(json['createdAt']) ?? '',
        updatedAt: asString(json['updatedAt']) ?? '',
      );

  final String id;
  final String title;
  final String? description;
  final String metricType;
  final double startValue;
  final double currentValue;
  final double endValue;
  final String health;
  final String? startDate;
  final String? endDate;
  final String createdAt;
  final String updatedAt;

  double get progress {
    final range = endValue - startValue;
    if (range == 0) return currentValue >= endValue ? 1 : 0;
    return ((currentValue - startValue) / range).clamp(0, 1);
  }
}
