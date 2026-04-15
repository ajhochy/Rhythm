import 'reservation.dart';

class ReservationSeries {
  const ReservationSeries({
    required this.id,
    required this.facilityId,
    required this.title,
    required this.requesterName,
    required this.recurrenceType,
    required this.startDate,
    this.startTime,
    this.endTime,
    this.requesterUserId,
    this.createdByUserId,
    this.notes,
    this.recurrenceInterval,
    this.weekdayPattern,
    this.customDates = const [],
    this.endDate,
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final int facilityId;
  final String title;
  final String requesterName;
  final String? startTime;
  final String? endTime;
  final int? requesterUserId;
  final int? createdByUserId;
  final String? notes;
  final String recurrenceType;
  final int? recurrenceInterval;
  final Map<String, dynamic>? weekdayPattern;
  final List<String> customDates;
  final String startDate;
  final String? endDate;
  final String? createdAt;
  final String? updatedAt;

  factory ReservationSeries.fromJson(Map<String, dynamic> json) {
    return ReservationSeries(
      id: _asString(json['id']) ?? '',
      facilityId:
          _asInt(json['facilityId']) ?? _asInt(json['facility_id']) ?? 0,
      title: _asString(json['title']) ?? '',
      requesterName:
          _asString(json['requesterName']) ??
          _asString(json['requester_name']) ??
          '',
      startTime: _asString(json['startTime']) ?? _asString(json['start_time']),
      endTime: _asString(json['endTime']) ?? _asString(json['end_time']),
      requesterUserId:
          _asInt(json['requesterUserId']) ?? _asInt(json['requester_user_id']),
      createdByUserId:
          _asInt(json['createdByUserId']) ?? _asInt(json['created_by_user_id']),
      notes: _asString(json['notes']),
      recurrenceType:
          _asString(json['recurrenceType']) ??
          _asString(json['recurrence_type']) ??
          'weekly',
      recurrenceInterval:
          _asInt(json['recurrenceInterval']) ??
          _asInt(json['recurrence_interval']),
      weekdayPattern: json['weekdayPattern'] is Map<String, dynamic>
          ? json['weekdayPattern'] as Map<String, dynamic>
          : json['weekday_pattern'] is Map<String, dynamic>
          ? json['weekday_pattern'] as Map<String, dynamic>
          : null,
      customDates:
          _asStringList(json['customDates']) ??
          _asStringList(json['custom_dates']) ??
          const [],
      startDate:
          _asString(json['startDate']) ?? _asString(json['start_date']) ?? '',
      endDate: _asString(json['endDate']) ?? _asString(json['end_date']),
      createdAt: _asString(json['createdAt']) ?? _asString(json['created_at']),
      updatedAt: _asString(json['updatedAt']) ?? _asString(json['updated_at']),
    );
  }
}

class ReservationSeriesConflict {
  const ReservationSeriesConflict({required this.date, required this.reason});

  final String date;
  final String reason;

  factory ReservationSeriesConflict.fromJson(Map<String, dynamic> json) {
    return ReservationSeriesConflict(
      date: _asString(json['date']) ?? '',
      reason: _asString(json['reason']) ?? '',
    );
  }
}

class ReservationSeriesCreationResult {
  const ReservationSeriesCreationResult({
    required this.series,
    required this.createdReservations,
    required this.conflicts,
    this.createdGroups = const [],
  });

  final ReservationSeries series;
  final List<String> createdGroups;
  final List<Reservation> createdReservations;
  final List<ReservationSeriesConflict> conflicts;

  factory ReservationSeriesCreationResult.fromJson(Map<String, dynamic> json) {
    return ReservationSeriesCreationResult(
      series: ReservationSeries.fromJson(
        json['series'] as Map<String, dynamic>,
      ),
      createdGroups: json['createdGroups'] is List
          ? (json['createdGroups'] as List)
                .map(
                  (item) =>
                      _asString((item as Map<String, dynamic>)['id']) ?? '',
                )
                .where((id) => id.isNotEmpty)
                .toList()
          : const [],
      createdReservations: json['createdReservations'] is List
          ? (json['createdReservations'] as List)
                .map(
                  (item) => Reservation.fromJson(item as Map<String, dynamic>),
                )
                .toList()
          : const [],
      conflicts: json['conflicts'] is List
          ? (json['conflicts'] as List)
                .map(
                  (item) => ReservationSeriesConflict.fromJson(
                    item as Map<String, dynamic>,
                  ),
                )
                .toList()
          : const [],
    );
  }
}

String? _asString(dynamic value) {
  return value is String ? value : null;
}

int? _asInt(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value);
  return null;
}

List<String>? _asStringList(dynamic value) {
  if (value is List) {
    return value.map((item) => item.toString()).toList();
  }
  return null;
}
