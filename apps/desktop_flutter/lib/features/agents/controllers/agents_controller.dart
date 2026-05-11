import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import '../../../app/core/agents/agent_server_controller.dart';
import '../../../app/core/notifications/local_notification_service.dart';
import '../../notifications/controllers/notifications_controller.dart';
import '../models/agent_session.dart';
import '../models/agent_session_connectivity.dart';
import '../models/agent_session_message.dart';
import '../models/agent_ws_message.dart';
import '../repositories/agents_repository.dart';

enum AgentsLoadStatus { idle, loading, error }

class PendingTrigger {
  PendingTrigger({
    required this.taskId,
    required this.taskTitle,
    required this.arrivedAt,
  });

  final String taskId;
  final String taskTitle;
  final DateTime arrivedAt;
}

class AgentsController extends ChangeNotifier with WidgetsBindingObserver {
  AgentsController(
    this._repository,
    this._agentServerController,
    this._notificationService,
    this._notificationsController,
  );

  final AgentsRepository _repository;
  final AgentServerController _agentServerController;
  final LocalNotificationService _notificationService;
  final NotificationsController _notificationsController;

  AppLifecycleState _lifecycleState = AppLifecycleState.resumed;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _lifecycleState = state;
  }

  AgentsLoadStatus _status = AgentsLoadStatus.idle;
  String? _error;
  bool _reconnecting = false;

  List<AgentSession> _sessions = [];
  List<AgentSession> _resumable = [];
  String? _selectedSessionId;
  List<AgentSessionMessage> _transcript = [];

  /// Live PTY output buffer keyed by session id.
  /// Plain string concatenation; capped at ~200 KB to prevent unbounded growth.
  final Map<String, String> _liveOutputBuffer = {};

  /// Keyed by session id; true when the agent is actively running a command.
  final Map<String, bool> _working = {};

  final List<PendingTrigger> _pendingTriggers = [];

  AgentSessionConnectivity _connectivity = const AgentSessionConnectivity();

  /// Tracks the first time each session was observed in the `starting` state.
  /// Used by [_recomputeStuck] to detect sessions stuck for >30s.
  ///
  /// Exposed for testing only — do not read or write this map in production
  /// code outside of [AgentsController].
  @visibleForTesting
  final Map<String, DateTime> sessionFirstSeenAt = {};

  Timer? _stuckCheckTimer;

  StreamSubscription<AgentWsMessage>? _wsSub;
  StreamSubscription<bool>? _connectivitySub;

  // --------------------------------------------------------------------------
  // Getters
  // --------------------------------------------------------------------------

  AgentsLoadStatus get status => _status;

  AgentSessionConnectivity get connectivity => _connectivity;
  String? get error => _error;
  List<AgentSession> get sessions => List.unmodifiable(_sessions);
  List<AgentSession> get resumable => List.unmodifiable(_resumable);
  String? get selectedSessionId => _selectedSessionId;

  AgentSession? get selectedSession =>
      _sessions.firstWhereOrNull((s) => s.id == _selectedSessionId) ??
      _resumable.firstWhereOrNull((s) => s.id == _selectedSessionId);

  List<AgentSessionMessage> get transcript => List.unmodifiable(_transcript);

  String liveOutputFor(String sessionId) => _liveOutputBuffer[sessionId] ?? '';

  bool isWorking(String sessionId) => _working[sessionId] ?? false;

  List<PendingTrigger> get pendingTriggers =>
      List.unmodifiable(_pendingTriggers);

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  Future<void> initialize() async {
    WidgetsBinding.instance.addObserver(this);
    if (!_agentServerController.isReady ||
        !_agentServerController.hasAnyAgent) {
      // Agent server not ready or no CLI installed → skip WebSocket connect;
      // UI guard handles display.
      return;
    }
    await _repository.connect();
    _wsSub = _repository.messages.listen(_onWsMessage);
    _connectivitySub = _repository.connectivityStream.listen((connected) {
      if (connected) {
        if (_connectivity.isWsDisconnected) {
          _connectivity = _connectivity.copyWith(isWsDisconnected: false);
          notifyListeners();
        }
      } else {
        if (!_connectivity.isWsDisconnected) {
          _connectivity = _connectivity.copyWith(isWsDisconnected: true);
          notifyListeners();
        }
      }
    });
    _stuckCheckTimer =
        Timer.periodic(const Duration(seconds: 5), (_) => _recomputeStuck());
    await load();
  }

  // --------------------------------------------------------------------------
  // REST operations
  // --------------------------------------------------------------------------

  Future<void> load() async {
    _status = AgentsLoadStatus.loading;
    notifyListeners();
    try {
      final result = await _repository.listSessions();
      _sessions = result
          .where((s) =>
              s.status != AgentSessionStatus.closed &&
              s.status != AgentSessionStatus.resumable)
          .toList();
      _resumable = result
          .where((s) => s.status == AgentSessionStatus.resumable)
          .toList();
      _status = AgentsLoadStatus.idle;
      _error = null;
    } catch (e) {
      _status = AgentsLoadStatus.error;
      _error = e.toString();
    }
    notifyListeners();
  }

  Future<AgentSession?> createSession({
    required String agentId,
    String? taskId,
    required String cwd,
    required String name,
  }) async {
    try {
      final session = await _repository.createSession(
        agentId: agentId,
        taskId: taskId,
        cwd: cwd,
        name: name,
      );
      _sessions = [..._sessions, session];
      sessionFirstSeenAt[session.id] = DateTime.now();
      notifyListeners();
      return session;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return null;
    }
  }

  Future<void> closeSession(String id) async {
    if (!_agentServerController.isReady) {
      _sessions = _sessions.where((s) => s.id != id).toList();
      if (_selectedSessionId == id) _selectedSessionId = null;
      _liveOutputBuffer.remove(id);
      sessionFirstSeenAt.remove(id);
      notifyListeners();
      return;
    }
    try {
      await _repository.closeSession(id);
      // The `session.closed` WS message will update state.
    } catch (e) {
      _error = e.toString();
      notifyListeners();
    }
  }

  Future<void> resumeSession(String id) async {
    try {
      final session = await _repository.resumeSession(id);
      _resumable = _resumable.where((s) => s.id != id).toList();
      _sessions = [..._sessions, session];
      _liveOutputBuffer.remove(id);
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      notifyListeners();
    }
  }

  Future<void> reconnectSession(String id) async {
    if (_reconnecting) return;
    _reconnecting = true;
    try {
      if (!_agentServerController.isReady) {
        await _agentServerController.retry();
        await load();
        return;
      }
      _repository.send({'type': 'session.subscribe', 'id': id});
      final result = await _repository.getSession(id);
      if (_selectedSessionId == id) {
        _transcript = result.messages;
        notifyListeners();
      }
    } catch (e) {
      _error = e.toString();
      notifyListeners();
    } finally {
      _reconnecting = false;
    }
  }

  // --------------------------------------------------------------------------
  // WebSocket send helpers
  // --------------------------------------------------------------------------

  void sendInput(String sessionId, String data) {
    _repository.send({'type': 'session.input', 'id': sessionId, 'data': data});
  }

  void resize(String sessionId, int cols, int rows) {
    _repository.send({
      'type': 'session.resize',
      'id': sessionId,
      'cols': cols,
      'rows': rows,
    });
  }

  // --------------------------------------------------------------------------
  // Session selection
  // --------------------------------------------------------------------------

  Future<void> selectSession(String id) async {
    _selectedSessionId = id;
    _transcript = [];
    notifyListeners();
    try {
      final result = await _repository.getSession(id);
      if (_selectedSessionId == id) {
        _transcript = result.messages;
        notifyListeners();
      }
      _repository.send({'type': 'session.subscribe', 'id': id});
    } catch (e) {
      _error = e.toString();
      notifyListeners();
    }
  }

  // --------------------------------------------------------------------------
  // Pending triggers
  // --------------------------------------------------------------------------

  void dismissTrigger(String taskId) {
    _pendingTriggers.removeWhere((t) => t.taskId == taskId);
    notifyListeners();
  }

  /// Debug-only: inject a synthetic pending trigger directly into the local
  /// store, bypassing the production `claude-triggers` polling path.
  ///
  /// Used by smoke tests (and the dart-define entry point in `main.dart`) to
  /// open the inline-error trigger bubble without needing Computer Use or any
  /// production network round-trip.
  ///
  /// No-op outside [kDebugMode] so seeded triggers can never appear in
  /// release builds. Pair with `RHYTHM_LOCAL_SMOKE=1` so the
  /// [AgentTriggerWatcher] is silenced and won't reconcile the seeded
  /// trigger away.
  void seedTriggerForDebug({
    required String taskId,
    required String taskTitle,
  }) {
    if (!kDebugMode) return;
    if (taskId.isEmpty) return;
    if (_pendingTriggers.any((t) => t.taskId == taskId)) return;
    _pendingTriggers.add(PendingTrigger(
      taskId: taskId,
      taskTitle: taskTitle,
      arrivedAt: DateTime.now(),
    ));
    notifyListeners();
  }

  /// Handles an incoming trigger received from production polling.
  ///
  /// The trigger [map] must contain at least `taskId` and `taskTitle` keys.
  /// If a trigger with the same `taskId` is already pending it is ignored so
  /// that a failed DELETE does not create duplicate bubbles.
  Future<void> handleIncomingTrigger(Map<String, dynamic> trigger) async {
    final taskId = trigger['taskId'] as String? ??
        trigger['task_id'] as String? ??
        trigger['id']?.toString();
    final taskTitle = trigger['taskTitle'] as String? ??
        trigger['task_title'] as String? ??
        trigger['title'] as String? ??
        '';

    if (taskId == null || taskId.isEmpty) return;

    // Deduplicate — if the trigger is already pending, skip.
    if (_pendingTriggers.any((t) => t.taskId == taskId)) return;

    _pendingTriggers.add(PendingTrigger(
      taskId: taskId,
      taskTitle: taskTitle,
      arrivedAt: DateTime.now(),
    ));
    notifyListeners();
  }

  // --------------------------------------------------------------------------
  // WebSocket message handler
  // --------------------------------------------------------------------------

  void _onWsMessage(AgentWsMessage msg) {
    if (msg is SessionsListMessage) {
      _sessions = msg.sessions
          .where((s) =>
              s.status != AgentSessionStatus.closed &&
              s.status != AgentSessionStatus.resumable)
          .toList();
      _resumable = [
        ...msg.sessions.where((s) => s.status == AgentSessionStatus.resumable),
        ...msg.resumable,
      ];
      // Record first-seen for any newly observed starting sessions.
      for (final s in msg.sessions) {
        if (s.status == AgentSessionStatus.starting) {
          sessionFirstSeenAt[s.id] ??= DateTime.now();
        }
      }
    } else if (msg is SessionCreatedMessage) {
      if (!_sessions.any((s) => s.id == msg.session.id)) {
        _sessions = [..._sessions, msg.session];
      }
      // Record first-seen via WS (??= so createSession() timestamp takes
      // precedence if the REST call already recorded it).
      sessionFirstSeenAt[msg.session.id] ??= DateTime.now();
    } else if (msg is SessionClosedMessage) {
      final closed = _sessions.firstWhereOrNull((s) => s.id == msg.id);
      _sessions = _sessions.where((s) => s.id != msg.id).toList();
      sessionFirstSeenAt.remove(msg.id);
      if (closed != null && msg.resumable) {
        _resumable = [
          ..._resumable,
          closed.copyWith(status: AgentSessionStatus.resumable),
        ];
      }
    } else if (msg is SessionStatusMessage) {
      _working[msg.id] = msg.working;
    } else if (msg is OutputMessage) {
      final prev = _liveOutputBuffer[msg.id] ?? '';
      final next = prev + msg.data;
      _liveOutputBuffer[msg.id] = next.length > 200 * 1024
          ? next.substring(next.length - 150 * 1024)
          : next;
      // Output arriving means the session is no longer stuck — remove it from
      // the tracking map immediately so the next _recomputeStuck tick clears it.
      final session = _sessions.firstWhereOrNull((s) => s.id == msg.id);
      if (session != null && session.status == AgentSessionStatus.starting) {
        sessionFirstSeenAt.remove(msg.id);
      }
    } else if (msg is TriggerFiredMessage) {
      _pendingTriggers.add(PendingTrigger(
        taskId: msg.taskId,
        taskTitle: msg.taskTitle,
        arrivedAt: DateTime.now(),
      ));
    } else if (msg is NotificationPushMessage) {
      _notificationsController.pushAgentNotification(
        id: msg.id,
        title: msg.title,
        body: msg.body,
      );
      if (_lifecycleState != AppLifecycleState.resumed) {
        _notificationService.showMessageNotification(
          id: msg.id,
          title: msg.title,
          body: msg.body,
        );
      }
    }
    notifyListeners();
  }

  // --------------------------------------------------------------------------
  // Stuck-session detection
  // --------------------------------------------------------------------------

  /// Test-only entry point that directly invokes [_recomputeStuck] so tests can
  /// assert stuck detection without waiting for the real [Timer].
  @visibleForTesting
  void recomputeStuckForTest() => _recomputeStuck();

  /// Recomputes the set of sessions considered "stuck" and notifies listeners
  /// only when the set changes.
  ///
  /// A session is stuck when:
  ///   - Its status is [AgentSessionStatus.starting].
  ///   - Its live output buffer is empty (no PTY output has arrived yet).
  ///   - It has been in the starting state for >30 seconds.
  void _recomputeStuck() {
    const stuckThreshold = Duration(seconds: 30);
    final now = DateTime.now();

    final newStuck = <String>{};
    for (final s in _sessions) {
      if (s.status != AgentSessionStatus.starting) continue;
      final firstSeen = sessionFirstSeenAt[s.id];
      if (firstSeen == null) continue;
      if ((_liveOutputBuffer[s.id] ?? '').isNotEmpty) continue;
      if (now.difference(firstSeen) > stuckThreshold) {
        newStuck.add(s.id);
      }
    }

    if (newStuck != _connectivity.stuckSessionIds) {
      _connectivity = _connectivity.copyWith(stuckSessionIds: newStuck);
      notifyListeners();
    }
  }

  // --------------------------------------------------------------------------
  // Dispose
  // --------------------------------------------------------------------------

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stuckCheckTimer?.cancel();
    _wsSub?.cancel();
    _connectivitySub?.cancel();
    _repository.dispose();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
// Extension helper
// ---------------------------------------------------------------------------

extension _IterableWhereOrNull<T> on Iterable<T> {
  T? firstWhereOrNull(bool Function(T) test) {
    for (final e in this) {
      if (test(e)) return e;
    }
    return null;
  }
}
