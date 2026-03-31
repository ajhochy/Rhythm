class Facility {
  const Facility({
    required this.id,
    required this.name,
    this.description,
    this.location,
  });

  final int id;
  final String name;
  final String? description;
  final String? location;

  factory Facility.fromJson(Map<String, dynamic> json) {
    return Facility(
      id: json['id'] as int,
      name: json['name'] as String,
      description: json['description'] as String?,
      location: json['location'] as String?,
    );
  }
}
