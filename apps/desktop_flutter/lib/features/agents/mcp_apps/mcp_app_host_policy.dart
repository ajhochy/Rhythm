import 'dart:convert';

/// Resource and lifecycle ceilings for one untrusted MCP App view.
abstract final class McpAppHostLimits {
  static const maxContentBytes = 1024 * 1024;
  static const maxMessageBytes = 64 * 1024;
  static const maxViews = 4;
  static const maxWidth = 2560;
  static const maxHeight = 1600;
  static const maxLifetime = Duration(minutes: 5);
  static const maxRequestIdBytes = 256;
  static const maxBootNonceBytes = 256;
}

enum McpAppHostMode {
  off,
  readonly,
  interactive;

  /// Unknown, missing, or non-canonical values deliberately resolve to off.
  static McpAppHostMode parse(String? value) => switch (value) {
        'readonly' => readonly,
        'interactive' => interactive,
        _ => off,
      };
}

final class McpAppHostDenied implements Exception {
  const McpAppHostDenied(this.reason);

  final String reason;

  @override
  String toString() => 'McpAppHostDenied($reason)';
}

final class McpAppHostDecision {
  const McpAppHostDecision.allow(this.requestId, this.method) : reason = null;

  const McpAppHostDecision.deny(this.reason)
      : requestId = null,
        method = null;

  final String? requestId;
  final String? method;
  final String? reason;

  bool get isAllowed => reason == null;

  @override
  bool operator ==(Object other) =>
      other is McpAppHostDecision &&
      requestId == other.requestId &&
      method == other.method &&
      reason == other.reason;

  @override
  int get hashCode => Object.hash(requestId, method, reason);

  @override
  String toString() => isAllowed
      ? 'McpAppHostDecision.allow($requestId, $method)'
      : 'McpAppHostDecision.deny($reason)';
}

final class McpAppHostViewState {
  McpAppHostViewState({
    required this.viewId,
    required this.bootNonce,
    required this.openedAt,
  });

  final String viewId;
  final String bootNonce;
  final DateTime openedAt;
  bool isOpen = true;
}

/// Pure-Dart authority for host view/message limits.
///
/// The native host independently applies the same ceilings. Keeping this
/// state machine in Dart lets the Flutter owner tear down a view before an
/// untrusted payload crosses the platform boundary.
final class McpAppHostPolicy {
  McpAppHostPolicy({required DateTime Function() now}) : _now = now;

  static const _supportedMethods = {'host.ping'};

  final DateTime Function() _now;
  final Map<String, McpAppHostViewState> _views = {};

  int get openViewCount => _views.values.where((view) => view.isOpen).length;

  McpAppHostViewState? view(String viewId) => _views[viewId];

  McpAppHostViewState openView({
    required String viewId,
    required String bootNonce,
    required int contentBytes,
    required int width,
    required int height,
  }) {
    _expireViews();
    if (viewId.isEmpty ||
        _utf8Length(viewId) > McpAppHostLimits.maxRequestIdBytes) {
      throw const McpAppHostDenied('invalid_view_id');
    }
    if (_views[viewId]?.isOpen ?? false) {
      throw const McpAppHostDenied('duplicate_view');
    }
    if (bootNonce.isEmpty ||
        _utf8Length(bootNonce) > McpAppHostLimits.maxBootNonceBytes) {
      throw const McpAppHostDenied('invalid_nonce');
    }
    if (contentBytes < 0 || contentBytes > McpAppHostLimits.maxContentBytes) {
      throw const McpAppHostDenied('content_too_large');
    }
    if (width < 1 ||
        height < 1 ||
        width > McpAppHostLimits.maxWidth ||
        height > McpAppHostLimits.maxHeight) {
      throw const McpAppHostDenied('invalid_dimensions');
    }
    if (openViewCount >= McpAppHostLimits.maxViews) {
      throw const McpAppHostDenied('too_many_views');
    }

    final state = McpAppHostViewState(
      viewId: viewId,
      bootNonce: bootNonce,
      openedAt: _now().toUtc(),
    );
    _views[viewId] = state;
    return state;
  }

  McpAppHostDecision validateMessage({
    required String viewId,
    required String origin,
    required String encodedMessage,
  }) {
    final state = _views[viewId];
    if (state == null || !state.isOpen) {
      return const McpAppHostDecision.deny('view_not_open');
    }
    if (_isExpired(state)) {
      teardown(viewId);
      return const McpAppHostDecision.deny('lifetime_expired');
    }
    if (origin != 'null') {
      return const McpAppHostDecision.deny('invalid_origin');
    }
    if (_utf8Length(encodedMessage) > McpAppHostLimits.maxMessageBytes) {
      teardown(viewId);
      return const McpAppHostDecision.deny('message_too_large');
    }

    final Object? decoded;
    try {
      decoded = jsonDecode(encodedMessage);
    } on FormatException {
      return const McpAppHostDecision.deny('malformed_message');
    }
    if (decoded is! Map<String, dynamic>) {
      return const McpAppHostDecision.deny('malformed_message');
    }

    final id = decoded['id'];
    final method = decoded['method'];
    final nonce = decoded['nonce'];
    if (id is! String ||
        id.isEmpty ||
        _utf8Length(id) > McpAppHostLimits.maxRequestIdBytes ||
        method is! String ||
        method.isEmpty ||
        nonce is! String) {
      return const McpAppHostDecision.deny('malformed_message');
    }
    if (nonce != state.bootNonce) {
      return const McpAppHostDecision.deny('invalid_nonce');
    }
    if (!_supportedMethods.contains(method)) {
      return const McpAppHostDecision.deny('unsupported_method');
    }
    return McpAppHostDecision.allow(id, method);
  }

  void teardown(String viewId) {
    _views[viewId]?.isOpen = false;
  }

  void teardownAll() {
    for (final view in _views.values) {
      view.isOpen = false;
    }
    _views.clear();
  }

  void _expireViews() {
    for (final view in _views.values) {
      if (view.isOpen && _isExpired(view)) {
        view.isOpen = false;
      }
    }
  }

  bool _isExpired(McpAppHostViewState view) =>
      _now().toUtc().difference(view.openedAt) > McpAppHostLimits.maxLifetime;

  static int _utf8Length(String value) => utf8.encode(value).length;
}
