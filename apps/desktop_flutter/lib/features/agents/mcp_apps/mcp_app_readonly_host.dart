import 'dart:convert';
import 'dart:math';

import 'mcp_app_host_policy.dart';

const _mcpAppMimeType = 'text/html;profile=mcp-app';

typedef McpAppResourceFetcher = Future<McpAppHtmlResource> Function({
  required String sessionId,
  required String callId,
});

typedef McpAppMutation = Future<void> Function(Map<String, Object?> message);
typedef McpAppOutbound = Future<void> Function(String encodedMessage);

final class McpAppHtmlResource {
  const McpAppHtmlResource({required this.mimeType, required this.text});

  final String mimeType;
  final String text;

  factory McpAppHtmlResource.fromJson(Map<String, dynamic> json) {
    final mimeType = json['mimeType'];
    final text = json['text'];
    if (mimeType != _mcpAppMimeType || text is! String) {
      throw const McpAppHostDenied('resource_unavailable');
    }
    if (utf8.encode(text).length > McpAppHostLimits.maxContentBytes) {
      throw const McpAppHostDenied('resource_unavailable');
    }
    return McpAppHtmlResource(mimeType: mimeType as String, text: text);
  }
}

/// Passive descriptor retained from the engine-owned completed tool call.
///
/// The URI and server are validated so malformed provenance never activates a
/// view, but are deliberately not exposed to the resource fetcher. Flutter may
/// ask only its fixed localhost API for the persisted session/call pair.
final class McpAppResourceDescriptor {
  const McpAppResourceDescriptor({
    required this.sessionId,
    required this.callId,
    required this.serverName,
    required this.resourceUri,
    required this.advertisedAt,
    required this.expiresAt,
  });

  final String sessionId;
  final String callId;
  final String serverName;
  final String resourceUri;
  final DateTime advertisedAt;
  final DateTime expiresAt;

  static McpAppResourceDescriptor? tryParse(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    final sessionId = raw['sessionID'];
    final callId = raw['callID'];
    final serverName = raw['serverName'];
    final resourceUri = raw['resourceUri'];
    final advertisedRaw = raw['advertisedAt'];
    final expiresRaw = raw['expiresAt'];
    if (sessionId is! String ||
        sessionId.isEmpty ||
        callId is! String ||
        callId.isEmpty ||
        serverName is! String ||
        serverName.isEmpty ||
        resourceUri is! String ||
        resourceUri.isEmpty ||
        advertisedRaw is! String ||
        expiresRaw is! String ||
        !_isIsoZulu(advertisedRaw) ||
        !_isIsoZulu(expiresRaw)) {
      return null;
    }
    final uri = Uri.tryParse(resourceUri);
    final advertisedAt = DateTime.tryParse(advertisedRaw)?.toUtc();
    final expiresAt = DateTime.tryParse(expiresRaw)?.toUtc();
    if (uri?.scheme != 'ui' ||
        advertisedAt == null ||
        expiresAt == null ||
        !expiresAt.isAfter(advertisedAt) ||
        expiresAt.difference(advertisedAt) > const Duration(minutes: 10)) {
      return null;
    }
    return McpAppResourceDescriptor(
      sessionId: sessionId,
      callId: callId,
      serverName: serverName,
      resourceUri: resourceUri,
      advertisedAt: advertisedAt,
      expiresAt: expiresAt,
    );
  }

  static bool _isIsoZulu(String value) =>
      RegExp(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$').hasMatch(value);
}

final class McpAppReadOnlySnapshot {
  const McpAppReadOnlySnapshot({
    required this.fallbackVisible,
    required this.htmlVisible,
    required this.isGenericToolCard,
    this.resource,
    this.errorCode,
  });

  final bool fallbackVisible;
  final bool htmlVisible;
  final bool isGenericToolCard;
  final McpAppHtmlResource? resource;
  final String? errorCode;
}

/// Generic read-only MCP App lifecycle. It contains no server- or tool-specific
/// branches and has no mutation capability.
final class McpAppReadOnlyHost {
  McpAppReadOnlyHost({
    required String mode,
    required this.sessionId,
    required this.callId,
    required this.fallbackText,
    this.structuredFallback,
    required this.fetchResource,
    McpAppMutation? onMutation,
    this.sendToApp,
    void Function(String event)? log,
    DateTime Function()? now,
  })  : mode = McpAppHostMode.parse(mode),
        _log = log,
        _policy = McpAppHostPolicy(now: now ?? DateTime.now),
        bootNonce = _nonce();

  final McpAppHostMode mode;
  final String sessionId;
  final String callId;
  final String fallbackText;
  final Object? structuredFallback;
  final McpAppResourceFetcher fetchResource;
  final McpAppOutbound? sendToApp;
  final void Function(String event)? _log;
  final McpAppHostPolicy _policy;
  final String bootNonce;
  final String _viewId = 'readonly-mcp-app';

  McpAppReadOnlySnapshot snapshot = const McpAppReadOnlySnapshot(
    fallbackVisible: true,
    htmlVisible: false,
    isGenericToolCard: false,
  );

  Future<void> load() async {
    if (mode != McpAppHostMode.readonly) {
      snapshot = const McpAppReadOnlySnapshot(
        fallbackVisible: true,
        htmlVisible: false,
        isGenericToolCard: true,
      );
      return;
    }
    try {
      final resource = await fetchResource(
        sessionId: sessionId,
        callId: callId,
      );
      if (resource.mimeType != _mcpAppMimeType ||
          utf8.encode(resource.text).length >
              McpAppHostLimits.maxContentBytes) {
        throw const McpAppHostDenied('resource_unavailable');
      }
      _policy.openView(
        viewId: _viewId,
        bootNonce: bootNonce,
        contentBytes: utf8.encode(resource.text).length,
        width: 800,
        height: 360,
      );
      snapshot = McpAppReadOnlySnapshot(
        fallbackVisible: true,
        htmlVisible: true,
        isGenericToolCard: false,
        resource: resource,
      );
      _log?.call('resource_ready');
    } on Object {
      snapshot = const McpAppReadOnlySnapshot(
        fallbackVisible: true,
        htmlVisible: false,
        isGenericToolCard: false,
        errorCode: 'resource_unavailable',
      );
      _log?.call('resource_unavailable');
    }
  }

  Future<McpAppHostDecision> handleAppMessage(
    String encodedMessage, {
    String origin = 'null',
  }) async {
    final decision = _policy.validateMessage(
      viewId: _viewId,
      origin: origin,
      encodedMessage: encodedMessage,
    );
    _log?.call(decision.isAllowed ? 'host_ping' : 'denied:${decision.reason}');
    return decision;
  }

  Future<void> initialize({required String theme}) => _sendLifecycle(
        'ui/initialize',
        {'mode': 'readonly', 'theme': theme},
      );

  Future<void> deliverInput(Object? input) =>
      _sendLifecycle('ui/notifications/tool-input', {'input': input});

  Future<void> deliverResult(Object? result) =>
      _sendLifecycle('ui/notifications/tool-result', {'result': result});

  Future<void> updateTheme(String theme) =>
      _sendLifecycle('ui/notifications/theme-changed', {'theme': theme});

  Future<void> updateSize({required int width, required int height}) {
    if (width < 1 ||
        height < 1 ||
        width > McpAppHostLimits.maxWidth ||
        height > McpAppHostLimits.maxHeight) {
      throw const McpAppHostDenied('invalid_dimensions');
    }
    return _sendLifecycle(
      'ui/notifications/size-changed',
      {'width': width, 'height': height},
    );
  }

  Future<void> ping() => _sendLifecycle('ui/ping', const {});

  Future<void> _sendLifecycle(
    String method,
    Map<String, Object?> params,
  ) async {
    if (!snapshot.htmlVisible || sendToApp == null) return;
    final encoded = jsonEncode({'method': method, 'params': params});
    if (utf8.encode(encoded).length > McpAppHostLimits.maxMessageBytes) {
      throw const McpAppHostDenied('message_too_large');
    }
    await sendToApp!(encoded);
    _log?.call(method);
  }

  void teardown() {
    _policy.teardown(_viewId);
    snapshot = McpAppReadOnlySnapshot(
      fallbackVisible: true,
      htmlVisible: false,
      isGenericToolCard: mode != McpAppHostMode.readonly,
    );
    _log?.call('teardown');
  }

  static String _nonce() {
    final random = Random.secure();
    final bytes = List<int>.generate(24, (_) => random.nextInt(256));
    return base64UrlEncode(bytes).replaceAll('=', '');
  }
}
