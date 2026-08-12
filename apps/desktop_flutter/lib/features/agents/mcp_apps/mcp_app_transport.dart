import 'dart:async';
import 'dart:convert';

typedef McpAppTransportSend = Future<void> Function(String encodedMessage);
typedef McpAppTransportEvent = void Function(Object? event);

/// Bounded request/response channel owned by the trusted Flutter shell.
///
/// The untrusted frame receives only the opaque view capability. HTTP auth and
/// all session/server/resource authority remain inside the data source/API.
final class McpAppTransport {
  McpAppTransport({
    required this.viewCapability,
    required McpAppTransportSend send,
    required McpAppTransportEvent onEvent,
    this.timeout = const Duration(seconds: 10),
  })  : _send = send,
        _onEvent = onEvent;

  static const maxMessageBytes = 64 * 1024;
  static const maxPending = 32;

  final String viewCapability;
  final McpAppTransportSend _send;
  final McpAppTransportEvent _onEvent;
  final Duration timeout;
  final Map<String, _PendingRequest> _pending = {};
  int _nextId = 0;
  bool _connected = true;
  bool _tornDown = false;

  int get pendingCount => _pending.length;

  Future<dynamic> request(String method, Map<String, Object?> params) {
    if (_tornDown || !_connected || _pending.length >= maxPending) {
      return Future.error(StateError('transport_unavailable'));
    }
    if (method.isEmpty || utf8.encode(method).length > 256) {
      return Future.error(StateError('malformed_request'));
    }
    final id = 'view-${++_nextId}';
    final encoded = jsonEncode({
      'capability': viewCapability,
      'id': id,
      'method': method,
      'params': params,
    });
    if (utf8.encode(encoded).length > maxMessageBytes) {
      return Future.error(StateError('message_too_large'));
    }

    final completer = Completer<dynamic>();
    final timer = Timer(timeout, () {
      final request = _pending.remove(id);
      request?.completer.completeError(TimeoutException('mcp_app_timeout'));
    });
    _pending[id] = _PendingRequest(completer, timer);
    Future.sync(() => _send(encoded)).catchError((Object error) {
      final request = _pending.remove(id);
      request?.timer.cancel();
      request?.completer.completeError(error);
    });
    return completer.future;
  }

  bool receive(String encodedMessage) {
    if (_tornDown || utf8.encode(encodedMessage).length > maxMessageBytes) {
      return false;
    }
    final Object? decoded;
    try {
      decoded = jsonDecode(encodedMessage);
    } on FormatException {
      return false;
    }
    if (decoded is! Map<String, dynamic>) return false;
    if (decoded['kind'] == 'event') {
      _onEvent(decoded['event']);
      return true;
    }
    if (decoded['kind'] != 'response') return false;
    final id = decoded['id'];
    if (id is! String) return false;
    final request = _pending.remove(id);
    if (request == null) return false;
    request.timer.cancel();
    if (decoded['error'] != null) {
      request.completer.completeError(StateError('capability_denied'));
    } else {
      request.completer.complete(decoded['result']);
    }
    return true;
  }

  void disconnect() {
    if (_tornDown) return;
    _connected = false;
    _failPending('transport_disconnected');
  }

  void teardown() {
    _tornDown = true;
    _connected = false;
    _failPending('transport_torn_down');
  }

  void _failPending(String reason) {
    final pending = _pending.values.toList(growable: false);
    _pending.clear();
    for (final request in pending) {
      request.timer.cancel();
      request.completer.completeError(StateError(reason));
    }
  }
}

final class _PendingRequest {
  const _PendingRequest(this.completer, this.timer);

  final Completer<dynamic> completer;
  final Timer timer;
}
