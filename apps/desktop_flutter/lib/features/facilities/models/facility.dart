class Facility {
  const Facility({
    required this.id,
    required this.name,
    this.description,
    this.location,
    this.building,
  });

  final int id;
  final String name;
  final String? description;
  final String? location;
  final String? building;

  factory Facility.fromJson(Map<String, dynamic> json) {
    return Facility(
      id: _asInt(json['id']) ?? 0,
      name: _asString(json['name']) ?? '',
      description: _asString(json['description']),
      location: _asString(json['location']),
      building: _asString(json['building']),
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
