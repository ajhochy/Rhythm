/// issue (smoke-fix) — session-scoped PTY terminal state.
///
/// Holds the live shell state for ONE agent session's Terminal tab: the xterm
/// [Terminal], the PTY id, the transport channel, the stream subscription, and
/// a connection [PtyTerminalStatus]. Owned by [AgentsController] and keyed by
/// session id, so its lifetime is tied to the SESSION — not to the
/// [TerminalTab] widget.
///
/// This fixes the bug where collapsing the side panel or switching the panel's
/// Context/Changes/Terminal tabs disposed the widget and killed the PTY, losing
/// the live shell. The widget is now a thin view that binds to this manager;
/// remounting the widget reuses the same [PtyTerminalSession] (same buffer,
/// same shell). The PTY is torn down only when the session is closed/deleted or
/// the controller is disposed.
///
/// Lifecycle:
///   - [start]: createPty → open channel via the injected factory → wire I/O.
///   - [restart]: teardown-then-start (New terminal / Retry actions).
///   - [dispose]: cancel subscription, close channel, killPty (fire-and-forget).
///
/// Status states: connecting (spinner), connected (TerminalView), exited
/// ("[process exited]" + New terminal), error (message + Retry).
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:stream_channel/stream_channel.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:xterm/xterm.dart';

/// Factory that opens the transport channel for a given ptyId. Injectable so
/// tests can supply a fake channel without a real socket/engine.
typedef PtyChannelFactory = StreamChannel<dynamic> Function(String ptyId);

enum PtyTerminalStatus { connecting, connected, exited, error }

/// Per-session terminal manager. A [ChangeNotifier] so the [TerminalTab] view
/// rebuilds on status changes regardless of which controller owns it.
class PtyTerminalSession extends ChangeNotifier {
  PtyTerminalSession({
    required this.sessionId,
    required Future<String> Function(String sessionId) createPty,
    required Future<void> Function(String ptyId, int cols, int rows) resizePty,
    required Future<void> Function(String ptyId) killPty,
    required String Function(String ptyId) ptyWsUrl,
    PtyChannelFactory? channelFactory,
  })  : _createPty = createPty,
        _resizePty = resizePty,
        _killPty = killPty,
        _ptyWsUrl = ptyWsUrl,
        _channelFactory = channelFactory {
    terminal.onOutput = (data) {
      _channel?.sink.add(data);
    };
    terminal.onResize = (width, height, pixelWidth, pixelHeight) {
      final id = _ptyId;
      if (id != null) {
        // xterm reports width=cols, height=rows.
        unawaited(_resizePty(id, width, height));
      }
    };
  }

  final String sessionId;

  final Future<String> Function(String sessionId) _createPty;
  final Future<void> Function(String ptyId, int cols, int rows) _resizePty;
  final Future<void> Function(String ptyId) _killPty;
  final String Function(String ptyId) _ptyWsUrl;
  final PtyChannelFactory? _channelFactory;

  /// The xterm terminal. Created ONCE and reused across widget remounts so the
  /// scrollback buffer survives panel collapse / tab switches.
  final Terminal terminal = Terminal(maxLines: 10000);

  StreamChannel<dynamic>? _channel;
  StreamSubscription<dynamic>? _sub;
  String? _ptyId;
  PtyTerminalStatus _status = PtyTerminalStatus.connecting;
  bool _disposed = false;

  PtyTerminalStatus get status => _status;

  /// The live PTY id, or null before [start] resolves / after teardown.
  @visibleForTesting
  String? get ptyId => _ptyId;

  /// Create the PTY, open the channel, and wire bidirectional I/O. Called once
  /// when the manager is first created (lazily, on first Terminal-tab open) and
  /// again by [restart].
  Future<void> start() async {
    _setStatus(PtyTerminalStatus.connecting);
    try {
      final id = await _createPty(sessionId);
      if (_disposed) {
        // Manager was disposed mid-create; clean up the orphaned PTY.
        unawaited(_killPty(id));
        return;
      }
      _ptyId = id;

      final factory = _channelFactory ?? _defaultChannelFactory;
      final channel = factory(id);
      _channel = channel;

      _sub = channel.stream.listen(
        (event) {
          terminal.write(
            event is String ? event : utf8.decode(event as List<int>),
          );
        },
        onDone: () => _setStatus(PtyTerminalStatus.exited),
        onError: (_) => _setStatus(PtyTerminalStatus.error),
      );

      _setStatus(PtyTerminalStatus.connected);
    } catch (_) {
      _setStatus(PtyTerminalStatus.error);
    }
  }

  StreamChannel<dynamic> _defaultChannelFactory(String ptyId) =>
      WebSocketChannel.connect(Uri.parse(_ptyWsUrl(ptyId)));

  /// Tear down the current PTY/socket without restarting. Safe to call when
  /// already torn down: cancelling a completed subscription, closing an
  /// already-closed sink, and killing a dead pty are all no-ops.
  void _teardown() {
    _sub?.cancel();
    _sub = null;
    _channel?.sink.close();
    _channel = null;
    final id = _ptyId;
    if (id != null) {
      unawaited(_killPty(id));
    }
    _ptyId = null;
  }

  /// Restart the terminal (New terminal / Retry). Tears down any live PTY first
  /// so neither the error path (live channel that errored) nor the exited path
  /// (stream already done, pty already dead) leaks resources.
  void restart() {
    _teardown();
    unawaited(start());
  }

  void _setStatus(PtyTerminalStatus status) {
    if (_disposed) return;
    if (_status == status) return;
    _status = status;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _teardown();
    super.dispose();
  }
}
