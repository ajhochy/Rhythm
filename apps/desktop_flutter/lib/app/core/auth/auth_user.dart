import '../utils/json_parsing.dart';

class AuthUser {
  const AuthUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.isFacilitiesManager = false,
    this.photoUrl,
    this.emailNotificationsEnabled = true,
  });

  final int id;
  final String name;
  final String email;
  final String role;
  final bool isFacilitiesManager;
  final String? photoUrl;
  final bool emailNotificationsEnabled;

  bool get isAdmin => role == 'admin' || role == 'system';

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
      emailNotificationsEnabled:
          json['emailNotificationsEnabled'] as bool? ?? true,
    );
  }
}

String? _asString(dynamic value) {
  return asString(value);
}

int? _asInt(dynamic value) {
  return asInt(value);
}

bool? _asBool(dynamic value) {
  return asBool(value);
}
