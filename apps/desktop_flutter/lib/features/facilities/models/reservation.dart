class Reservation {
  const Reservation({
    required this.id,
    required this.facilityId,
    required this.title,
    required this.requesterName,
    this.startTime,
    this.endTime,
    this.notes,
    this.seriesId,
    this.requesterUserId,
    this.createdByName,
    this.createdByUserId,
    this.externalEventId,
    this.externalSource,
    this.createdByRhythm = true,
    this.isConflicted = false,
    this.conflictReason,
    this.createdAt,
    this.updatedAt,
  });

  final int id;
  final int facilityId;
  final String? seriesId;
  final String title;
  final String requesterName;
  final int? requesterUserId;
  final String? createdByName;
  final int? createdByUserId;
  final String? startTime;
  final String? endTime;
  final String? notes;
  final String? externalEventId;
  final String? externalSource;
  final bool createdByRhythm;
  final bool isConflicted;
  final String? conflictReason;
  final String? createdAt;
  final String? updatedAt;

  String get reservedBy => requesterName;

  factory Reservation.fromJson(Map<String, dynamic> json) {
    return Reservation(
      id: _asInt(json['id']) ?? 0,
      facilityId:
          _asInt(json['facilityId']) ?? _asInt(json['facility_id']) ?? 0,
      seriesId: _asString(json['seriesId']) ?? _asString(json['series_id']),
      title: _asString(json['title']) ?? '',
      requesterName: _asString(json['requesterName']) ??
          _asString(json['reservedBy']) ??
          _asString(json['reserved_by']) ??
          '',
      requesterUserId: _asInt(json['requesterUserId']) ??
          _asInt(json['reservedByUserId']) ??
          _asInt(json['reserved_by_user_id']),
      createdByName: _asString(json['createdByName']) ??
          _asString(json['created_by_name']),
      createdByUserId:
          _asInt(json['createdByUserId']) ?? _asInt(json['created_by_user_id']),
      startTime: _asString(json['startTime']) ?? _asString(json['start_time']),
      endTime: _asString(json['endTime']) ?? _asString(json['end_time']),
      notes: _asString(json['notes']),
      externalEventId: _asString(json['externalEventId']) ??
          _asString(json['external_event_id']),
      externalSource: _asString(json['externalSource']) ??
          _asString(json['external_source']),
      createdByRhythm: _asBool(json['createdByRhythm']) ??
          _asBool(json['created_by_rhythm']) ??
          true,
      isConflicted: _asBool(json['isConflicted']) ??
          _asBool(json['is_conflicted']) ??
          false,
      conflictReason: _asString(json['conflictReason']) ??
          _asString(json['conflict_reason']),
      createdAt: _asString(json['createdAt']) ?? _asString(json['created_at']),
      updatedAt: _asString(json['updatedAt']) ?? _asString(json['updated_at']),
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

bool? _asBool(dynamic value) {
  if (value is bool) return value;
  if (value is num) return value != 0;
  if (value is String) {
    switch (value.toLowerCase()) {
      case 'true':
      case '1':
      case 'yes':
        return true;
      case 'false':
      case '0':
      case 'no':
        return false;
    }
  }
  return null;
}
