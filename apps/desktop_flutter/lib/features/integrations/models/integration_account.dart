class IntegrationAccount {
  IntegrationAccount({
    required this.id,
    required this.provider,
    required this.status,
    required this.connected,
    this.email,
    this.displayName,
    this.lastSyncedAt,
    this.errorMessage,
  });

  factory IntegrationAccount.fromJson(Map<String, dynamic> json) {
    final status = json['status'] as String? ?? 'error';
    return IntegrationAccount(
      id: json['id'] as String? ?? (json['provider'] as String? ?? ''),
      provider: json['provider'] as String,
      status: status,
      connected: status == 'connected',
      email: json['email'] as String?,
      displayName: json['displayName'] as String?,
      lastSyncedAt: json['lastSyncedAt'] as String?,
      errorMessage: json['errorMessage'] as String?,
    );
  }

  final String id;
  final String provider;
  final String status;
  final bool connected;
  final String? email;
  final String? displayName;
  final String? lastSyncedAt;
  final String? errorMessage;
}
