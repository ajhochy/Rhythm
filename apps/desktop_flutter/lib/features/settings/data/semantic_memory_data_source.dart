import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';

const _safeUnavailableMessage =
    'Semantic Memory is temporarily unavailable. Standard memory search remains active.';

class SemanticMemoryApiException implements Exception {
  const SemanticMemoryApiException(this.message);

  final String message;

  @override
  String toString() => message;
}

class SemanticMemoryStatus {
  const SemanticMemoryStatus({
    required this.enabled,
    required this.state,
    required this.hasExecutable,
    this.discoverySource,
    this.version,
    this.lastHealthyAt,
    this.failureCategory,
  });

  final bool enabled;
  final String state;
  final bool hasExecutable;
  final String? discoverySource;
  final String? version;
  final DateTime? lastHealthyAt;
  final String? failureCategory;

  bool get isWorking =>
      state == 'discovering' || state == 'indexing' || state == 'starting';

  factory SemanticMemoryStatus.fromJson(Map<String, dynamic> json) {
    final rawHealthyAt = json['lastHealthyAt'];
    return SemanticMemoryStatus(
      enabled: json['enabled'] == true,
      state: json['state'] as String? ?? 'disabled',
      hasExecutable: json['executablePath'] is String &&
          (json['executablePath'] as String).isNotEmpty,
      discoverySource: json['discoverySource'] as String?,
      version: json['version'] as String?,
      lastHealthyAt:
          rawHealthyAt is String ? DateTime.tryParse(rawHealthyAt) : null,
      failureCategory: json['lastFailureCategory'] as String?,
    );
  }
}

class SemanticMemoryCandidate {
  const SemanticMemoryCandidate({
    required this.path,
    required this.source,
  });

  final String path;
  final String source;

  factory SemanticMemoryCandidate.fromJson(Map<String, dynamic> json) {
    return SemanticMemoryCandidate(
      path: json['path'] as String? ?? '',
      source: json['source'] as String? ?? 'path',
    );
  }
}

class SemanticMemoryHealth {
  const SemanticMemoryHealth({
    required this.ok,
    this.category,
    this.latencyMs,
  });

  final bool ok;
  final String? category;
  final int? latencyMs;

  factory SemanticMemoryHealth.fromJson(Map<String, dynamic> json) {
    return SemanticMemoryHealth(
      ok: json['ok'] == true,
      category: json['category'] as String?,
      latencyMs: (json['latencyMs'] as num?)?.round(),
    );
  }
}

abstract class SemanticMemoryDataSource {
  factory SemanticMemoryDataSource({
    String? baseUrl,
    http.Client? client,
  }) = _SemanticMemoryDataSourceImpl;

  @visibleForTesting
  String get baseUrlForTest;

  Future<SemanticMemoryStatus> getStatus();

  Future<List<SemanticMemoryCandidate>> discover();

  Future<void> chooseBinary(String path);

  Future<void> enable();

  Future<void> disable();

  Future<SemanticMemoryHealth> checkHealth();

  Future<void> retry();

  Future<void> rebuild();
}

class _SemanticMemoryDataSourceImpl implements SemanticMemoryDataSource {
  _SemanticMemoryDataSourceImpl({
    String? baseUrl,
    http.Client? client,
  })  : _baseUrl = baseUrl ?? AppConstants.agentLocalBaseUrl,
        _client = client ?? http.Client();

  final String _baseUrl;
  final http.Client _client;

  @override
  String get baseUrlForTest => _baseUrl;

  Uri _uri(String path) => Uri.parse('$_baseUrl/engraph-manager$path');

  Map<String, dynamic> _decodeObject(http.Response response) {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw const SemanticMemoryApiException(_safeUnavailableMessage);
    }
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) return decoded;
    } catch (_) {
      // The UI intentionally never surfaces a raw response body.
    }
    throw const SemanticMemoryApiException(_safeUnavailableMessage);
  }

  Future<Map<String, dynamic>> _post(String path) async {
    final response = await _client.post(_uri(path));
    return _decodeObject(response);
  }

  @override
  Future<SemanticMemoryStatus> getStatus() async {
    final response = await _client.get(_uri('/status'));
    return SemanticMemoryStatus.fromJson(_decodeObject(response));
  }

  @override
  Future<List<SemanticMemoryCandidate>> discover() async {
    final response = await _client.get(_uri('/discover'));
    final body = _decodeObject(response);
    final candidates = body['candidates'];
    if (candidates is! List) return const [];
    return candidates
        .whereType<Map<String, dynamic>>()
        .map(SemanticMemoryCandidate.fromJson)
        .where((candidate) => candidate.path.isNotEmpty)
        .toList(growable: false);
  }

  @override
  Future<void> chooseBinary(String path) async {
    final response = await _client.post(
      _uri('/choose-binary'),
      headers: const {'content-type': 'application/json'},
      body: jsonEncode({'path': path}),
    );
    final body = _decodeObject(response);
    if (body['ok'] != true) {
      throw const SemanticMemoryApiException(
        'Rhythm could not validate that Engraph app. Choose another copy or open the install guide.',
      );
    }
  }

  @override
  Future<void> enable() async {
    await _post('/enable');
  }

  @override
  Future<void> disable() async {
    await _post('/disable');
  }

  @override
  Future<SemanticMemoryHealth> checkHealth() async {
    return SemanticMemoryHealth.fromJson(await _post('/check-health'));
  }

  @override
  Future<void> retry() async {
    await _post('/retry');
  }

  @override
  Future<void> rebuild() async {
    await _post('/rebuild');
  }
}
