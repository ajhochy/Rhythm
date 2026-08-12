import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../notifications/data/human_approval_signer.dart';

enum TailscaleAccessState { missing, loggedOut, wrongTarget, healthy }

class MobileAccessStatus {
  const MobileAccessStatus({
    required this.state,
    required this.message,
    required this.canConfigure,
    this.gatewayUrl,
  });

  final TailscaleAccessState state;
  final String message;
  final bool canConfigure;
  final String? gatewayUrl;
}

class MobilePairingCode {
  const MobilePairingCode({
    required this.id,
    required this.hostId,
    required this.code,
    required this.expiresAt,
    required this.gatewayUrl,
    this.relayUrl,
  });

  final String id;
  final String hostId;
  final String code;
  final DateTime expiresAt;
  final String gatewayUrl;

  /// Relay-first pairing (docs/ai/plan-synology-relay.md): when the api_server
  /// advertises a relay base, it rides in the QR. The phone prefers it over
  /// the .ts.net gatewayUrl, so a device paired from this code never uses
  /// Tailscale for its data path.
  final String? relayUrl;

  String get qrPayload => jsonEncode(<String, String>{
        'gatewayUrl': gatewayUrl,
        'pairingCode': code,
        if (relayUrl != null && relayUrl!.isNotEmpty) 'relayUrl': relayUrl!,
      });
}

class MobileDevice {
  const MobileDevice({
    required this.id,
    required this.name,
    required this.createdAt,
    this.revokedAt,
  });

  final String id;
  final String name;
  final DateTime createdAt;
  final DateTime? revokedAt;

  bool get isActive => revokedAt == null;
}

class MobileAccessException implements Exception {
  const MobileAccessException(this.message);

  final String message;

  @override
  String toString() => message;
}

class MobileAccessDataSource {
  MobileAccessDataSource({
    http.Client? client,
    String? baseUrl,
    String? Function()? tokenProvider,
    HumanApprovalSigner? humanApprovalSigner,
  })  : _client = client ?? http.Client(),
        _ownsClient = client == null,
        _baseUrl = (baseUrl ?? AppConstants.agentLocalBaseUrl).replaceFirst(
          RegExp(r'/$'),
          '',
        ),
        _tokenProvider = tokenProvider ?? (() => AuthSessionStore.sessionToken),
        _humanApprovalSigner = humanApprovalSigner ?? HumanApprovalSigner();

  final http.Client _client;
  final bool _ownsClient;
  final String _baseUrl;
  final String? Function() _tokenProvider;
  final HumanApprovalSigner _humanApprovalSigner;

  Future<Map<String, String>> _headers({bool json = false}) async {
    final token = _tokenProvider();
    if (token == null || token.isEmpty) {
      throw const MobileAccessException(
        'Sign in to Rhythm before enabling mobile access.',
      );
    }
    final humanCapability =
        await _humanApprovalSigner.humanApprovalCapability();
    return <String, String>{
      'Authorization': 'Bearer $token',
      'X-Rhythm-Human-Approval': humanCapability,
      'Accept': 'application/json',
      if (json) 'Content-Type': 'application/json',
    };
  }

  Future<Map<String, dynamic>> _jsonResponse(
    Future<http.Response> request,
  ) async {
    http.Response response;
    try {
      response = await request.timeout(const Duration(seconds: 10));
    } catch (_) {
      throw const MobileAccessException(
        'The local Rhythm agent server is unavailable.',
      );
    }
    Map<String, dynamic>? body;
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) body = decoded;
    } catch (_) {
      body = null;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = body?['error'];
      final message =
          error is Map<String, dynamic> && error['message'] is String
              ? error['message'] as String
              : 'Mobile access request failed (${response.statusCode}).';
      throw MobileAccessException(message);
    }
    if (body == null) {
      throw const MobileAccessException(
        'The local Rhythm agent server returned an invalid response.',
      );
    }
    return body;
  }

  MobileAccessStatus _statusFromJson(Map<String, dynamic> json) {
    final state = switch (json['state']) {
      'missing' => TailscaleAccessState.missing,
      'loggedOut' => TailscaleAccessState.loggedOut,
      'wrongTarget' => TailscaleAccessState.wrongTarget,
      'healthy' => TailscaleAccessState.healthy,
      _ => throw const MobileAccessException(
          'The local Rhythm agent server returned an unknown Tailscale state.',
        ),
    };
    final gatewayUrl = json['gatewayUrl'];
    return MobileAccessStatus(
      state: state,
      gatewayUrl:
          gatewayUrl is String && gatewayUrl.isNotEmpty ? gatewayUrl : null,
      message: json['message'] is String
          ? json['message'] as String
          : 'Tailscale diagnostics are unavailable.',
      canConfigure: json['canConfigure'] == true,
    );
  }

  Future<MobileAccessStatus> fetchStatus() async {
    final body = await _jsonResponse(
      _client.get(
        Uri.parse('$_baseUrl/mobile-gateway/access'),
        headers: await _headers(),
      ),
    );
    return _statusFromJson(body);
  }

  Future<MobileAccessStatus> enableAccess() async {
    final body = await _jsonResponse(
      _client.post(
        Uri.parse('$_baseUrl/mobile-gateway/access/enable'),
        headers: await _headers(json: true),
        body: '{}',
      ),
    );
    return _statusFromJson(body);
  }

  Future<MobilePairingCode> createPairingCode(String gatewayUrl) async {
    final body = await _jsonResponse(
      _client.post(
        Uri.parse('$_baseUrl/mobile-gateway/pairing-codes'),
        headers: await _headers(json: true),
        body: '{}',
      ),
    );
    final id = body['id'];
    final hostId = body['hostId'];
    final code = body['pairingCode'];
    final relayUrl = body['relayUrl'];
    final expiresAt = DateTime.tryParse(body['expiresAt']?.toString() ?? '');
    if (id is! String ||
        hostId is! String ||
        code is! String ||
        expiresAt == null) {
      throw const MobileAccessException(
        'The local Rhythm agent server returned an invalid pairing code.',
      );
    }
    return MobilePairingCode(
      id: id,
      hostId: hostId,
      code: code,
      expiresAt: expiresAt,
      gatewayUrl: gatewayUrl,
      relayUrl: relayUrl is String && relayUrl.isNotEmpty ? relayUrl : null,
    );
  }

  Future<List<MobileDevice>> fetchDevices() async {
    http.Response response;
    try {
      response = await _client
          .get(
            Uri.parse('$_baseUrl/mobile-gateway/devices'),
            headers: await _headers(),
          )
          .timeout(const Duration(seconds: 10));
    } catch (_) {
      throw const MobileAccessException('Could not refresh paired iPhones.');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw MobileAccessException(
        'Could not refresh paired iPhones (${response.statusCode}).',
      );
    }
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      decoded = null;
    }
    if (decoded is! List) {
      throw const MobileAccessException(
        'The local Rhythm agent server returned an invalid device list.',
      );
    }
    return decoded.whereType<Map<String, dynamic>>().map((item) {
      final id = item['id'];
      final name = item['name'];
      final createdAt = DateTime.tryParse(
        item['createdAt']?.toString() ?? '',
      );
      final rawRevokedAt = item['revokedAt'];
      if (id is! String || name is! String || createdAt == null) {
        throw const MobileAccessException(
          'The local Rhythm agent server returned an invalid device.',
        );
      }
      return MobileDevice(
        id: id,
        name: name,
        createdAt: createdAt,
        revokedAt: rawRevokedAt == null
            ? null
            : DateTime.tryParse(rawRevokedAt.toString()),
      );
    }).toList(growable: false);
  }

  Future<void> revokeDevice(String deviceId) async {
    http.Response response;
    try {
      response = await _client
          .delete(
            Uri.parse(
              '$_baseUrl/mobile-gateway/devices/'
              '${Uri.encodeComponent(deviceId)}',
            ),
            headers: await _headers(),
          )
          .timeout(const Duration(seconds: 10));
    } catch (_) {
      throw const MobileAccessException('Could not revoke this iPhone.');
    }
    if (response.statusCode != 204) {
      throw MobileAccessException(
        'Could not revoke this iPhone (${response.statusCode}).',
      );
    }
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}
