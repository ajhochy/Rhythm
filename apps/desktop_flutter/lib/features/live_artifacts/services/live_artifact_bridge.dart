import 'dart:convert';

import '../data/live_artifacts_data_source.dart';
import '../models/live_artifact.dart';

/// The page-to-host protocol is deliberately smaller than the API protocol.
/// 64 KiB leaves headroom below the server's 512 KiB state ceiling.
class LiveArtifactBridge {
  LiveArtifactBridge({
    required this.artifactId,
    required this.userId,
    required this.generation,
    required this.source,
    required this.artifact,
    required this.isCurrent,
    this.onBlocked,
    this.debugOnMessage,
  });

  static const maxRequestBytes = 64 * 1024;
  static const maxInFlight = 8;
  static final _requestId = RegExp(r'^[A-Za-z0-9_-]{1,64}$');
  static const _methods = {
    'state.get',
    'state.update',
    'pco.services.read',
    'host.blocked'
  };
  static const _blockedReasons = {
    'navigation',
    'form',
    'download',
    'file',
    'media'
  };

  final String artifactId;
  final int userId;
  final int generation;
  final LiveArtifactsDataSource source;
  LiveArtifact artifact;
  final bool Function(int generation) isCurrent;
  final void Function(String reason)? onBlocked;
  final void Function(String raw)? debugOnMessage;
  final Set<String> _inFlight = {};

  Future<String> handle(String raw) async {
    debugOnMessage?.call(raw);
    if (utf8.encode(raw).length > maxRequestBytes) {
      return _error('', '', 'request_too_large');
    }
    try {
      final value = jsonDecode(raw);
      if (value is! Map<String, dynamic> ||
          value.keys
              .toSet()
              .difference({'id', 'method', 'params', 'nonce'}).isNotEmpty ||
          value['id'] is! String ||
          value['method'] is! String ||
          value['nonce'] is! String) {
        return _error('', '', 'malformed_request');
      }
      final id = value['id'] as String;
      final method = value['method'] as String;
      final nonce = value['nonce'] as String;
      if (!_requestId.hasMatch(id) || !_methods.contains(method)) {
        return _error(id, nonce, 'unsupported_request');
      }
      if (!_inFlight.add(id)) return _error(id, nonce, 'duplicate_request');
      if (_inFlight.length > maxInFlight) {
        _inFlight.remove(id);
        return _error(id, nonce, 'too_many_requests');
      }
      try {
        final result = await _dispatch(method, value['params']);
        if (!isCurrent(generation)) return '';
        return _success(id, nonce, result);
      } catch (_) {
        if (!isCurrent(generation)) return '';
        return _error(id, nonce, 'request_failed');
      } finally {
        _inFlight.remove(id);
      }
    } catch (_) {
      return _error('', '', 'malformed_request');
    }
  }

  Future<Object?> _dispatch(String method, Object? params) async {
    switch (method) {
      case 'state.get':
        if (params != null) throw const FormatException();
        return {
          'state': artifact.state,
          'stateRevision': artifact.currentStateRevision
        };
      case 'state.update':
        if (params is! Map<String, dynamic> ||
            params.keys
                .toSet()
                .difference({'expectedStateRevision', 'state'}).isNotEmpty ||
            params['expectedStateRevision'] is! int) {
          throw const FormatException();
        }
        final updated = await source.updateState(artifactId,
            expectedStateRevision: params['expectedStateRevision'] as int,
            state: params['state']);
        if (!isCurrent(generation)) throw const FormatException();
        artifact = updated;
        return {'stateRevision': artifact.currentStateRevision};
      case 'pco.services.read':
        if (!artifact.declaredCapabilities.contains('pco.services.read') ||
            !_isPcoRequest(params)) {
          throw const FormatException();
        }
        return source.readPcoServices(artifactId, params);
      case 'host.blocked':
        if (params is! String || !_blockedReasons.contains(params)) {
          throw const FormatException();
        }
        onBlocked?.call(params);
        return null;
      default:
        throw const FormatException();
    }
  }

  static bool _isPcoRequest(Object? value) {
    if (value is! Map<String, dynamic>) return false;
    final operation = value['operation'];
    if (operation == 'list_service_types') return value.length == 1;
    if (operation == 'list_plans') {
      return value.length == 3 &&
          value['serviceTypeId'] is String &&
          (value['filter'] == 'future' || value['filter'] == 'past');
    }
    return operation == 'list_plan_items' &&
        value.length == 3 &&
        value['serviceTypeId'] is String &&
        value['planId'] is String;
  }

  String _success(String id, String nonce, Object? data) => _script({
        'id': id,
        'n': nonce,
        'ok': true,
        'data': data,
      });
  String _error(String id, String nonce, String code) => _script({
        'id': id,
        'n': nonce,
        'ok': false,
        'error': {'code': code},
      });

  /// This is the only evaluated JavaScript: fixed callback plus JSON data.
  String _script(Object response) =>
      'window.__rhythmHostResponse(${jsonEncode(response)});';
}
