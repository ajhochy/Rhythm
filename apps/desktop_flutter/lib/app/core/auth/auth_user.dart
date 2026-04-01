class AuthUser {
  const AuthUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.photoUrl,
  });

  final int id;
  final String name;
  final String email;
  final String role;
  final String? photoUrl;

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: json['id'] as int,
      name: json['name'] as String,
      email: json['email'] as String,
      role: json['role'] as String? ?? 'member',
      photoUrl: json['photoUrl'] as String?,
    );
  }
}
