class Reservation {
  const Reservation({
    required this.id,
    required this.facilityId,
    required this.title,
    required this.reservedBy,
    this.startTime,
    this.endTime,
    this.notes,
  });

  final int id;
  final int facilityId;
  final String title;
  final String reservedBy;
  final String? startTime;
  final String? endTime;
  final String? notes;

  factory Reservation.fromJson(Map<String, dynamic> json) {
    return Reservation(
      id: json['id'] as int,
      facilityId: json['facilityId'] as int,
      title: json['title'] as String,
      reservedBy: json['reservedBy'] as String,
      startTime: json['startTime'] as String?,
      endTime: json['endTime'] as String?,
      notes: json['notes'] as String?,
    );
  }
}
