class WorkspaceMember {
  const WorkspaceMember({
    required this.userId,
    required this.name,
    required this.email,
    required this.role,
    required this.joinedAt,
  });

  final int userId;
  final String name;
  final String email;
  final String role;
  final String joinedAt;

  bool get isAdmin => role == 'admin';

  factory WorkspaceMember.fromJson(Map<String, dynamic> json) {
    return WorkspaceMember(
      userId: (json['userId'] as num).toInt(),
      name: json['name'] as String,
      email: json['email'] as String,
      role: json['role'] as String,
      joinedAt: json['joinedAt'] as String,
    );
  }
}
