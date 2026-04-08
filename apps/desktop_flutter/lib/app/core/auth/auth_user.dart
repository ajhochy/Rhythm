class AuthUser {
  const AuthUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.isFacilitiesManager = false,
    this.photoUrl,
  });

  final int id;
  final String name;
  final String email;
  final String role;
  final bool isFacilitiesManager;
  final String? photoUrl;

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: _asInt(json['id']) ?? 0,
      name: _asString(json['name']) ?? '',
      email: _asString(json['email']) ?? '',
      role: _asString(json['role']) ?? 'member',
      isFacilitiesManager: _asBool(json['isFacilitiesManager']) ??
          _asBool(json['is_facilities_manager']) ??
          false,
      photoUrl: _asString(json['photoUrl']) ?? _asString(json['photo_url']),
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
