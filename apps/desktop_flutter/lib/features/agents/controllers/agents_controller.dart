import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import '../../../app/core/agents/agent_server_controller.dart';
import '../../../app/core/errors/app_error.dart';
import '../../../app/core/notifications/local_notification_service.dart';
import '../../notifications/controllers/notifications_controller.dart';
import '../data/agent_models_data_source.dart';
import '../data/commands_data_source.dart';
import '../models/agent_model_route.dart';
import '../models/catalog_model_entry.dart';
import '../models/agent_session.dart';
import '../models/agent_session_connectivity.dart';
import '../models/agent_session_message.dart';
import '../models/agent_ws_message.dart';
import '../models/chat_models.dart';
import '../repositories/agents_repository.dart';

class PendingPermission {
  const PendingPermission({
    required this.sessionId,
    required this.permissionId,
    required this.toolName,
    required this.args,
    required this.summary,
  });

  final String sessionId;
  final String permissionId;
  final String toolName;
  final Map<String, dynamic> args;
  final String summary;
}

enum AgentsLoadStatus { idle, loading, error }

class PendingTrigger {
  PendingTrigger({
    required this.taskId,
    required this.taskTitle,
    required this.arrivedAt,
    this.taskNotes,
  });

  final String taskId;
  final String taskTitle;

  /// Task description / notes from the trigger payload. Used by #653 to
  /// prefill the composer with task context as an editable draft when the
  /// user opens the chat from the trigger bubble.
  final String? taskNotes;
  final DateTime arrivedAt;
}

class AgentsController extends ChangeNotifier with WidgetsBindingObserver {
  AgentsController(
    this._repository,
    this._agentServerController,
    this._notificationService,
    this._notificationsController,
  )   : _modelsDataSource = AgentModelsDataSource(),
        _commandsDataSource = CommandsDataSource();

  final AgentsRepository _repository;
  final AgentModelsDataSource _modelsDataSource;
  final CommandsDataSource _commandsDataSource;
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
  int? _lastErrorStatus;
  bool _reconnecting = false;

  List<AgentSession> _sessions = [];
  List<AgentSession> _resumable = [];
  List<AgentSession> _archived = [];
  String? _selectedSessionId;
  List<AgentSessionMessage> _transcript = [];

  /// Per-session transcript store — keyed by sessionId.
  /// Kept for WS error/system messages that need a home; NOT used for rendering
  /// after OPC-M1-3 (the view uses chatMessagesBySession exclusively).
  final Map<String, List<AgentSessionMessage>> _transcriptsBySession = {};

  // OPC-M1-3: PTY output buffer removed. Stuck detection now keys off
  // _lastPartActivityAt instead.

  // -- Parts-based chat store (Opencode Desktop port) ------------------------
  // Mirrors `sync.data.message[sessionID]` + `sync.data.part[messageID]`.
  // Streaming deltas append to `ChatPart.text` in place — the UI rebuilds via
  // notifyListeners() and the same message bubble grows in size.
  final Map<String, List<ChatMessage>> _chatMessagesBySession = {};
  final Map<String, List<ChatPart>> _chatPartsByMessage = {};

  /// OPC-M1-3: tracks when the most-recent part activity arrived for each
  /// session. Used by [_recomputeStuck] instead of the old PTY output buffer.
  final Map<String, DateTime> _lastPartActivityAt = {};

  /// Keyed by session id; true when the agent is actively running a command.
  final Map<String, bool> _working = {};

  final List<PendingTrigger> _pendingTriggers = [];

  // -- Permission state (#608) -----------------------------------------------
  // Keyed by sessionId → list of pending permissions.
  final Map<String, List<PendingPermission>> _pendingPermissions = {};

  // --------------------------------------------------------------------------
  // Model-picker state
  // --------------------------------------------------------------------------

  /// Catalogue of available routes for the currently selected session's agent.
  /// Refreshed whenever the selected session changes.
  List<AgentModelRoute> _modelRoutes = [];

  /// Loaded: true once a catalogue fetch has completed (even if empty).
  bool _modelRoutesLoaded = false;

  /// The per-turn override that will accompany the NEXT sendInput call.
  /// Cleared after the message is sent.
  AgentModelRoute? _pendingTurnOverride;

  // --------------------------------------------------------------------------
  // Full catalog cache (#602 — unified picker)
  // --------------------------------------------------------------------------

  /// Cross-agent model catalog from GET /agents/models/catalog.
  /// Cached for the app lifetime; refreshed on explicit [refreshCatalog] call.
  List<CatalogModelEntry> _catalog = [];
  bool _catalogLoaded = false;

  // --------------------------------------------------------------------------
  // Slash-command cache (Issue #610)
  // --------------------------------------------------------------------------
  /// Cached slash-commands per session id. Populated on first selectSession.
  final Map<String, List<SlashCommand>> _commandsBySession = {};
  bool _commandsFetchInFlight = false;

  // --------------------------------------------------------------------------
  // Notify-on-completion state (Issue #606)
  // --------------------------------------------------------------------------
  /// Set of (sessionId, messageId) pairs that have notify-on-completion armed.
  /// When the parent session transitions out of working, a desktop notification
  /// is fired for all messages in the working session that are armed.
  final Set<String> _notifyOnCompletion = {};

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
  int? get lastErrorStatus => _lastErrorStatus;
  List<AgentSession> get sessions => List.unmodifiable(_sessions);
  List<AgentSession> get resumable => List.unmodifiable(_resumable);
  List<AgentSession> get archived => List.unmodifiable(_archived);
  String? get selectedSessionId => _selectedSessionId;

  AgentSession? get selectedSession =>
      _sessions.firstWhereOrNull((s) => s.id == _selectedSessionId) ??
      _resumable.firstWhereOrNull((s) => s.id == _selectedSessionId);

  List<AgentSessionMessage> get transcript => List.unmodifiable(_transcript);

  /// Per-session transcript for [sessionId] — kept for internal WS error
  /// message routing. NOT exposed to the UI (view uses chatMessagesFor).
  List<AgentSessionMessage> transcriptFor(String sessionId) =>
      List.unmodifiable(_transcriptsBySession[sessionId] ?? const []);

  // OPC-M1-3: live output getter removed. Use chatMessagesFor() instead.

  /// Chat messages for [sessionId] in insertion order.
  List<ChatMessage> chatMessagesFor(String sessionId) =>
      List.unmodifiable(_chatMessagesBySession[sessionId] ?? const []);

  /// Parts (text, tool, reasoning, …) for [messageId] in insertion order.
  List<ChatPart> chatPartsFor(String messageId) =>
      List.unmodifiable(_chatPartsByMessage[messageId] ?? const []);

  bool isWorking(String sessionId) => _working[sessionId] ?? false;

  List<PendingTrigger> get pendingTriggers =>
      List.unmodifiable(_pendingTriggers);

  /// Pending permissions for [sessionId], in arrival order.
  List<PendingPermission> pendingPermissionsFor(String sessionId) =>
      List.unmodifiable(_pendingPermissions[sessionId] ?? const []);

  /// Available (provider, model, routeKind) rows for the current session's agent.
  List<AgentModelRoute> get modelRoutes => List.unmodifiable(_modelRoutes);

  /// True once the model catalogue has been fetched at least once.
  bool get modelRoutesLoaded => _modelRoutesLoaded;

  /// Per-turn model override that will ride the next [sendInput] call.
  AgentModelRoute? get pendingTurnOverride => _pendingTurnOverride;

  /// Full cross-agent model catalog (#602).
  List<CatalogModelEntry> get catalog => List.unmodifiable(_catalog);

  /// True once the catalog has been fetched at least once.
  bool get catalogLoaded => _catalogLoaded;

  /// Slash-commands for the current session, cached after first fetch.
  List<SlashCommand> get slashCommands =>
      List.unmodifiable(_commandsBySession[_selectedSessionId] ?? const []);

  /// Returns true if notify-on-completion is armed for [messageKey] (format: "$sessionId:$messageId").
  bool isNotifyArmed(String messageKey) =>
      _notifyOnCompletion.contains(messageKey);

  /// Toggle the notify-on-completion flag for a given message key.
  void toggleNotify(String messageKey) {
    if (_notifyOnCompletion.contains(messageKey)) {
      _notifyOnCompletion.remove(messageKey);
    } else {
      _notifyOnCompletion.add(messageKey);
    }
    notifyListeners();
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  bool _wsConnected = false;
  bool _serverListenerAttached = false;

  Future<void> initialize() async {
    WidgetsBinding.instance.addObserver(this);
    // Listen for the agent server to become ready so we can connect WS
    // once it does. Without this, the controller initializes once at
    // app launch (before the spawned api_server has booted), sees
    // `isReady=false`, gates out, and never retries — so the WS chat
    // pipeline never opens.
    if (!_serverListenerAttached) {
      _agentServerController.addListener(_onServerStateChanged);
      _serverListenerAttached = true;
    }
    await _tryConnectWs();
  }

  void _onServerStateChanged() {
    // Fired by AgentServerController on every status transition. Drive a
    // (possibly-deferred) WS connect from here.
    _tryConnectWs();
  }

  Future<void> _tryConnectWs() async {
    if (_wsConnected) return;
    if (!_agentServerController.isReady ||
        !_agentServerController.hasAnyAgent) {
      // Stay deferred; the listener will re-invoke us when the gate opens.
      return;
    }
    _wsConnected = true;
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
    _stuckCheckTimer = Timer.periodic(
      const Duration(seconds: 5),
      (_) => _recomputeStuck(),
    );
    await load();
    // Kick off the initial catalog fetch in the background.
    unawaited(refreshCatalog());
  }

  // --------------------------------------------------------------------------
  // REST operations
  // --------------------------------------------------------------------------

  /// #602 — Refresh the full cross-agent model catalog.
  /// Safe to call multiple times; a fresh server round-trip is performed
  /// each time. Called automatically on WS connect and on auth-state-change events.
  Future<void> refreshCatalog() async {
    final List<CatalogModelEntry> entries;
    try {
      entries = await _modelsDataSource.fetchCatalog();
    } catch (_) {
      return;
    }
    if (_disposed) return;
    final changed = !_catalogLoaded || !_catalogEquals(_catalog, entries);
    _catalog = entries;
    _catalogLoaded = true;
    if (changed && entries.isNotEmpty) notifyListeners();
  }

  static bool _catalogEquals(
    List<CatalogModelEntry> a,
    List<CatalogModelEntry> b,
  ) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].modelId != b[i].modelId || a[i].provider != b[i].provider) {
        return false;
      }
    }
    return true;
  }

  Future<void> load() async {
    _status = AgentsLoadStatus.loading;
    notifyListeners();
    try {
      final result = await _repository.listSessions();
      // Show closed sessions in the main list so users can read past
      // transcripts; the row UI greys them out and they can be removed via
      // the row's hard-delete action. Only `resumable` sessions move to the
      // dedicated section.
      _sessions = result
          .where((s) => s.status != AgentSessionStatus.resumable)
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

  /// Issue #653: the server now requires a non-null, non-'__pending__'
  /// agentId. To keep client callers compilable during the rollout, this
  /// method accepts a nullable `agentId` and falls back to the first
  /// authorized agent in the loaded catalog when null. Callers that have
  /// already picked an agent (the new trigger bubble) should always pass
  /// the explicit value. Callers that still defer (the "+ New session"
  /// form) get the catalog-default fallback so the server doesn't reject
  /// them with 400 until that surface is also migrated.
  Future<AgentSession?> createSession({
    String? agentId,
    String? taskId,
    required String cwd,
    required String name,
    String? branch,
    String? stash,
    bool createBranch = false,
  }) async {
    _error = null;
    _lastErrorStatus = null;
    // Issue #653: if the caller passed null, try to default to the first
    // authorized agent from the loaded catalog. If the catalog isn't loaded
    // yet OR has no authorized entries, pass null through to the repository
    // — the server will respond with 400 ('agent not configured') and we
    // surface that to the user verbatim (consistent with existing 4xx UX).
    final resolvedAgentId = agentId ?? _resolveDefaultAgentIdForCreate() ?? '';
    try {
      final session = await _repository.createSession(
        agentId: resolvedAgentId.isEmpty ? agentId : resolvedAgentId,
        taskId: taskId,
        cwd: cwd,
        name: name,
        branch: branch,
        stash: stash,
        createBranch: createBranch,
      );
      _sessions = [..._sessions, session];
      sessionFirstSeenAt[session.id] = DateTime.now();
      notifyListeners();
      return session;
    } catch (e) {
      if (e is AppError) {
        _error = e.message;
        _lastErrorStatus = e.statusCode;
      } else {
        _error = e.toString();
      }
      notifyListeners();
      return null;
    }
  }

  /// Issue #653: pick the first authorized catalog entry's agent as a safe
  /// default for `createSession` callers that haven't already chosen one.
  /// Returns null when the catalog hasn't been loaded yet or contains no
  /// authorized entries — caller must surface an error in that case.
  String? _resolveDefaultAgentIdForCreate() {
    if (!_catalogLoaded) return null;
    for (final entry in _catalog) {
      if (entry.authorized && entry.agent.isNotEmpty) {
        return entry.agent;
      }
    }
    return null;
  }

  // ==========================================================================
  // Issue #653: client-owned composer drafts
  //
  // When the user opens a chat from the task-ready bubble, the bubble stages
  // task title + notes into a per-session draft. The composer in agents_view
  // consumes this draft on session selection (one-shot read), prefilling the
  // text controller so the user can edit before hitting Enter. The draft is
  // never persisted server-side — that's the whole point of #653 (no more
  // server-seeded system messages).
  // ==========================================================================

  final Map<String, String> _composerDraftBySession = {};

  /// Stage a draft message for [sessionId]. Called by the trigger bubble
  /// immediately after createSession returns. Overwrites any existing draft
  /// for the same session id.
  void setComposerDraft(String sessionId, String text) {
    _composerDraftBySession[sessionId] = text;
    notifyListeners();
  }

  /// Read and clear the draft for [sessionId]. Returns null if no draft was
  /// staged. One-shot — subsequent calls return null.
  ///
  /// Issue #656: this is invoked from `_TranscriptPanel.build()`, so it MUST
  /// NOT call `notifyListeners()` — firing a notify during build marks the
  /// building widget dirty mid-build, which in release silently corrupts the
  /// transcript panel's rebuild scheduling (dead clicks, no streaming). The
  /// caller applies the returned draft directly to its TextEditingController
  /// via a post-frame callback; no rebuild is required here.
  String? consumeComposerDraft(String sessionId) {
    return _composerDraftBySession.remove(sessionId);
  }

  /// True if a draft exists for [sessionId] without consuming it (used by
  /// the composer to decide whether to focus on first build).
  bool hasComposerDraft(String sessionId) =>
      _composerDraftBySession.containsKey(sessionId);

  /// Bulk hard-delete sessions in parallel. Optimistically removes all
  /// rows from local state up-front; on per-row server failure the row
  /// is restored and an error surfaced. Used by Shift-click multi-select.
  Future<void> deleteSessions(Iterable<String> ids) async {
    final idSet = ids.toSet();
    if (idSet.isEmpty) return;
    final previous = _sessions;
    _sessions = _sessions.where((s) => !idSet.contains(s.id)).toList();
    if (_selectedSessionId != null && idSet.contains(_selectedSessionId)) {
      _selectedSessionId = null;
    }
    for (final id in idSet) {
      _chatMessagesBySession.remove(id);
      _lastPartActivityAt.remove(id);
      sessionFirstSeenAt.remove(id);
    }
    notifyListeners();

    if (!_agentServerController.isReady) return;
    final failed = <String>[];
    await Future.wait(idSet.map((id) async {
      try {
        await _repository.deleteSession(id);
      } catch (_) {
        failed.add(id);
      }
    }));
    if (failed.isNotEmpty) {
      // Restore the rows that failed (best effort: re-attach from `previous`).
      final restored = previous.where((s) => failed.contains(s.id)).toList();
      _sessions = [...restored, ..._sessions];
      _error = 'Failed to delete ${failed.length} session(s).';
      notifyListeners();
    }
  }

  /// Hard-delete a session (row + messages) via the new
  /// `DELETE /agent-sessions/:id/hard` endpoint. The list is updated
  /// optimistically; on failure we restore the row and surface the error.
  Future<void> deleteSession(String id) async {
    final previous = _sessions;
    _sessions = _sessions.where((s) => s.id != id).toList();
    if (_selectedSessionId == id) _selectedSessionId = null;
    _chatMessagesBySession.remove(id);
    _lastPartActivityAt.remove(id);
    sessionFirstSeenAt.remove(id);
    notifyListeners();

    if (!_agentServerController.isReady) return;
    try {
      await _repository.deleteSession(id);
    } catch (e) {
      _sessions = previous;
      if (e is AppError) {
        _error = e.message;
        _lastErrorStatus = e.statusCode;
      } else {
        _error = e.toString();
      }
      notifyListeners();
    }
  }

  /// M2-1 / M2-5 / #611: PATCH the session row (rename + persistent provider/model/permissionMode).
  Future<void> updateSession(
    String id, {
    String? name,
    String? providerId,
    String? modelId,
    bool clearProvider = false,
    bool clearModel = false,
    String? permissionMode,
  }) async {
    try {
      final updated = await _repository.updateSession(
        id,
        name: name,
        providerId: providerId,
        modelId: modelId,
        clearProvider: clearProvider,
        clearModel: clearModel,
        permissionMode: permissionMode,
      );
      _sessions = [
        for (final s in _sessions) s.id == id ? updated : s,
      ];
      notifyListeners();
    } catch (e) {
      _error = e is AppError ? e.message : e.toString();
      notifyListeners();
    }
  }

  /// M2-4: cancel an in-flight turn.
  Future<void> cancelSession(String id) async {
    try {
      await _repository.cancelSession(id);
    } catch (e) {
      _error = e is AppError ? e.message : e.toString();
      notifyListeners();
    }
  }

  // --------------------------------------------------------------------------
  // Permission flow (#608)
  // --------------------------------------------------------------------------

  /// Accept a pending permission — POST to the server and remove from local state.
  Future<void> acceptPermission(
    String sessionId,
    String permissionId,
  ) async {
    _removePendingPermission(sessionId, permissionId);
    notifyListeners();
    try {
      await _repository.respondPermission(sessionId, permissionId, 'accept');
    } catch (e) {
      _error = e is AppError ? e.message : e.toString();
      notifyListeners();
    }
  }

  /// Deny a pending permission — POST to the server and remove from local state.
  Future<void> denyPermission(
    String sessionId,
    String permissionId,
  ) async {
    _removePendingPermission(sessionId, permissionId);
    notifyListeners();
    try {
      await _repository.respondPermission(sessionId, permissionId, 'deny');
    } catch (e) {
      _error = e is AppError ? e.message : e.toString();
      notifyListeners();
    }
  }

  void _removePendingPermission(String sessionId, String permissionId) {
    final list = _pendingPermissions[sessionId];
    if (list != null) {
      list.removeWhere((p) => p.permissionId == permissionId);
      if (list.isEmpty) _pendingPermissions.remove(sessionId);
    }
  }

  // --------------------------------------------------------------------------
  // Permission mode (#611)
  // --------------------------------------------------------------------------

  /// PATCH the session's permissionMode. Optimistically updates the local row.
  Future<void> setPermissionMode(
    String sessionId,
    PermissionMode mode,
  ) async {
    // Optimistic update.
    _sessions = [
      for (final s in _sessions)
        if (s.id == sessionId) s.copyWith(permissionMode: mode) else s,
    ];
    notifyListeners();
    try {
      final updated = await _repository.updateSession(
        sessionId,
        permissionMode: mode.wireValue,
      );
      _sessions = [
        for (final s in _sessions) s.id == sessionId ? updated : s,
      ];
      notifyListeners();
    } catch (e) {
      _error = e is AppError ? e.message : e.toString();
      notifyListeners();
    }
  }

  Future<void> closeSession(String id) async {
    if (!_agentServerController.isReady) {
      _sessions = _sessions.where((s) => s.id != id).toList();
      if (_selectedSessionId == id) _selectedSessionId = null;
      sessionFirstSeenAt.remove(id);
      _lastPartActivityAt.remove(id);
      notifyListeners();
      return;
    }
    try {
      await _repository.closeSession(id);
      // The `session.closed` WS message will update state.
    } catch (e) {
      if (e is AppError) {
        _error = e.message;
        _lastErrorStatus = e.statusCode;
      } else {
        _error = e.toString();
      }
      notifyListeners();
    }
  }

  Future<void> resumeSession(String id) async {
    try {
      final session = await _repository.resumeSession(id);
      _resumable = _resumable.where((s) => s.id != id).toList();
      _sessions = [..._sessions, session];
      notifyListeners();
    } catch (e) {
      if (e is AppError) {
        _error = e.message;
        _lastErrorStatus = e.statusCode;
      } else {
        _error = e.toString();
      }
      notifyListeners();
    }
  }

  /// Archive a session (soft-delete: hidden from main list, kept in history).
  /// Optimistically moves the row to [_archived]; the server's WS `session.updated`
  /// broadcast will confirm the change without a reload.
  Future<void> archiveSession(String id) async {
    final session = _sessions.firstWhereOrNull((s) => s.id == id) ??
        _resumable.firstWhereOrNull((s) => s.id == id);
    if (session == null) return;
    _sessions = _sessions.where((s) => s.id != id).toList();
    _resumable = _resumable.where((s) => s.id != id).toList();
    if (_selectedSessionId == id) _selectedSessionId = null;
    notifyListeners();

    if (!_agentServerController.isReady) return;
    try {
      final updated = await _repository.archiveSession(id);
      // Insert into archived cache (dedupe by id).
      _archived = _upsertById(_archived, updated);
      notifyListeners();
    } catch (e) {
      // Restore on failure.
      _sessions = [..._sessions, session];
      _error = e is AppError ? e.message : e.toString();
      notifyListeners();
    }
  }

  /// Unarchive a session, moving it back to the main [_sessions] list.
  Future<void> unarchiveSession(String id) async {
    final session = _archived.firstWhereOrNull((s) => s.id == id);
    if (session == null) return;
    _archived = _archived.where((s) => s.id != id).toList();
    notifyListeners();

    if (!_agentServerController.isReady) return;
    try {
      final updated = await _repository.unarchiveSession(id);
      _sessions = _upsertById(_sessions, updated);
      notifyListeners();
    } catch (e) {
      _archived = [..._archived, session];
      _error = e is AppError ? e.message : e.toString();
      notifyListeners();
    }
  }

  /// Load archived sessions on demand (e.g. when the Archived section is expanded).
  /// Caches results in [_archived]; call again to refresh.
  Future<void> loadArchivedSessions() async {
    if (!_agentServerController.isReady) return;
    try {
      final sessions = await _repository.listSessions(archivedOnly: true);
      _archived = sessions;
      notifyListeners();
    } catch (e) {
      _error = e is AppError ? e.message : e.toString();
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
      // OPC-M1-3: rehydrate from structured REST payload into chat stores.
      _rehydrateChatMessages(id, result.messages);
      notifyListeners();
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

  void sendInput(
    String sessionId,
    String data, {
    List<Map<String, dynamic>>? attachments,
  }) {
    final override = _pendingTurnOverride;
    final useParts = attachments != null && attachments.isNotEmpty;
    _repository.send({
      'type': 'session.input',
      'id': sessionId,
      // M4-1: when attachments exist, send a structured parts array; the
      // backend composes text + files into the SDK promptAsync call.
      if (useParts)
        'parts': [
          {'type': 'text', 'text': data},
          ...attachments,
        ]
      else
        'data': data,
      // M2-2: per-turn override is consumed once on send, never persisted.
      if (override != null)
        'modelOverride': {
          'providerId': override.providerId,
          'modelId': override.modelId,
        },
    });
    if (override != null) _pendingTurnOverride = null;
    // OPC-M1-3: optimistic insert into the parts-based chat store so the user's
    // message appears immediately in the single render path.
    final optimisticMsgId =
        'optimistic-input-${DateTime.now().millisecondsSinceEpoch}';
    final optimisticMsg = ChatMessage(
      id: optimisticMsgId,
      sessionId: sessionId,
      role: 'user',
      createdAt: DateTime.now(),
    );
    (_chatMessagesBySession[sessionId] ??= []).add(optimisticMsg);
    _chatPartsByMessage[optimisticMsgId] = [
      ChatPart(
        id: '${optimisticMsgId}_text',
        messageId: optimisticMsgId,
        type: 'text',
        text: data,
      ),
    ];
    notifyListeners();
  }

  /// Convenience wrapper used by SessionModelPicker — stages a per-turn
  /// override using the picker's row type. Pass null to clear.
  void setTurnOverride(AgentModelRoute? route) {
    _pendingTurnOverride = route;
    notifyListeners();
  }

  /// Convenience wrapper used by SessionModelPicker — persists the route as
  /// the session-level default via [updateSession].
  ///
  /// Also sets the pending turn override so the very next [send] still ships
  /// a `modelOverride` in the WS message. Without this, the session row in
  /// the DB has the model persisted but the server-side resolver for
  /// `agentKind === '__pending__'` rejects the input ("Pick a model before
  /// sending the first message.") because the per-turn override is empty —
  /// the persisted default is read from the DB but it hasn't been written
  /// yet from the server's perspective when `session.input` arrives.
  Future<void> setSessionModel(
    String sessionId,
    AgentModelRoute route,
  ) async {
    _pendingTurnOverride = route;
    notifyListeners();
    await updateSession(
      sessionId,
      providerId: route.providerId,
      modelId: route.modelId,
    );
  }

  /// Issue #604 — set the session-level thinking budget (null = off).
  Future<void> setThinkingBudget(String sessionId, int? budget) async {
    // Optimistic update.
    _sessions = [
      for (final s in _sessions)
        if (s.id == sessionId)
          // Pass null via the sentinel path to actually clear the field.
          AgentSession(
            id: s.id,
            taskId: s.taskId,
            agentId: s.agentId,
            status: s.status,
            sessionToken: s.sessionToken,
            cwd: s.cwd,
            name: s.name,
            projectId: s.projectId,
            providerId: s.providerId,
            modelId: s.modelId,
            permissionMode: s.permissionMode,
            thinkingBudget: budget,
            fastMode: s.fastMode,
            lastPreview: s.lastPreview,
            lastActivityAt: s.lastActivityAt,
            archivedAt: s.archivedAt,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          )
        else
          s,
    ];
    notifyListeners();
    try {
      // Pass budget explicitly; null clears the field on the server.
      final updated = await _repository.updateSessionThinkingBudget(
        sessionId,
        budget,
      );
      _sessions = [
        for (final s in _sessions) s.id == sessionId ? updated : s,
      ];
      notifyListeners();
    } catch (e) {
      _error = e is AppError ? e.message : e.toString();
      notifyListeners();
    }
  }

  /// Issue #604 — set the session-level fast-mode flag.
  Future<void> setFastMode(String sessionId, {required bool enabled}) async {
    // Optimistic update.
    _sessions = [
      for (final s in _sessions)
        if (s.id == sessionId) s.copyWith(fastMode: enabled) else s,
    ];
    notifyListeners();
    try {
      final updated = await _repository.updateSession(
        sessionId,
        fastMode: enabled,
      );
      _sessions = [
        for (final s in _sessions) s.id == sessionId ? updated : s,
      ];
      notifyListeners();
    } catch (e) {
      _error = e is AppError ? e.message : e.toString();
      notifyListeners();
    }
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
    _modelRoutes = [];
    _modelRoutesLoaded = false;
    _pendingTurnOverride = null;
    notifyListeners();
    try {
      final result = await _repository.getSession(id);
      _rehydrateChatMessages(id, result.messages);
      if (_selectedSessionId == id) {
        notifyListeners();
      }
      _repository.send({'type': 'session.subscribe', 'id': id});
    } catch (e) {
      _error = e.toString();
      notifyListeners();
    }
    // Load model routes for the newly selected session in the background.
    _loadModelRoutes(id);
    // Load slash commands for this session (Issue #610).
    _loadSlashCommands(id);
  }

  Future<void> _loadSlashCommands(String sessionId) async {
    // If already cached or a fetch is already in flight, skip.
    if (_commandsBySession.containsKey(sessionId)) return;
    if (_commandsFetchInFlight) return;
    _commandsFetchInFlight = true;
    try {
      final commands = await _commandsDataSource.list();
      _commandsBySession[sessionId] = commands;
      if (_selectedSessionId == sessionId) notifyListeners();
    } catch (_) {
      // Silently degrade — popover shows empty state.
    } finally {
      _commandsFetchInFlight = false;
    }
  }

  /// #639 — Re-fetch model routes for the currently-selected session.
  /// Called after the OpenRouter visibility map is changed in Settings so the
  /// picker refreshes without requiring a session switch.
  /// No-op when no session is selected.
  Future<void> refreshModelRoutes() async {
    if (_selectedSessionId != null) {
      await _loadModelRoutes(_selectedSessionId!);
    }
    await refreshCatalog();
  }

  Future<void> _loadModelRoutes(String sessionId) async {
    final session = _sessions.firstWhereOrNull((s) => s.id == sessionId) ??
        _resumable.firstWhereOrNull((s) => s.id == sessionId);
    if (session == null) return;
    final routes = await _modelsDataSource.fetchRoutes(session.agentId);
    if (_disposed) return;
    if (_selectedSessionId != sessionId) return;
    _modelRoutes = routes;
    _modelRoutesLoaded = true;
    notifyListeners();
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
    _pendingTriggers.add(
      PendingTrigger(
        taskId: taskId,
        taskTitle: taskTitle,
        arrivedAt: DateTime.now(),
      ),
    );
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
    // Issue #653: capture taskNotes so the bubble can prefill the composer
    // with task title + notes when the user clicks Open chat.
    final taskNotes = trigger['taskNotes'] as String? ??
        trigger['task_notes'] as String? ??
        trigger['notes'] as String?;

    if (taskId == null || taskId.isEmpty) return;

    // Deduplicate — if the trigger is already pending, skip.
    if (_pendingTriggers.any((t) => t.taskId == taskId)) return;

    _pendingTriggers.add(
      PendingTrigger(
        taskId: taskId,
        taskTitle: taskTitle,
        taskNotes: taskNotes,
        arrivedAt: DateTime.now(),
      ),
    );
    notifyListeners();
  }

  // --------------------------------------------------------------------------
  // OPC-M1-3: REST rehydration into chat stores
  // --------------------------------------------------------------------------

  /// Populate [_chatMessagesBySession] and [_chatPartsByMessage] from the
  /// structured REST payload returned by `GET /agent-sessions/:id`.
  ///
  /// Merges with any WS-streamed messages already in the chat store so that
  /// in-flight parts from the live session are preserved. REST rows that have
  /// a matching [ChatMessage.id] (either sdkMessageId or db-id-as-string) are
  /// skipped — the WS-streamed version is already authoritative.
  void _rehydrateChatMessages(
    String sessionId,
    List<AgentSessionMessage> restMessages,
  ) {
    final existingMsgIds =
        (_chatMessagesBySession[sessionId] ?? const <ChatMessage>[])
            .map((m) => m.id)
            .toSet();

    for (final row in restMessages) {
      // Prefer sdkMessageId as the stable identity; fall back to db-id string.
      final msgId = (row.sdkMessageId?.isNotEmpty == true)
          ? row.sdkMessageId!
          : row.id.toString();

      if (msgId.isEmpty) continue;

      // Insert ChatMessage if not already present from WS streaming.
      if (!existingMsgIds.contains(msgId)) {
        final chatMsg = ChatMessage(
          id: msgId,
          sessionId: sessionId,
          role: row.role,
          createdAt: row.createdAt,
        );
        (_chatMessagesBySession[sessionId] ??= []).add(chatMsg);
        existingMsgIds.add(msgId);
      }

      // Populate parts only when the REST row carries them AND the message has
      // no WS-streamed parts yet (avoid overwriting live streaming state).
      final existingParts = _chatPartsByMessage[msgId];
      if (existingParts == null || existingParts.isEmpty) {
        final rawParts = row.parts;
        if (rawParts != null && rawParts.isNotEmpty) {
          _chatPartsByMessage[msgId] =
              rawParts.map((p) => ChatPart.fromJson(msgId, p)).toList();
        } else if (row.rawText.isNotEmpty) {
          // Legacy shim: synthesise a single text part from rawText.
          _chatPartsByMessage[msgId] = [
            ChatPart(
              id: '${msgId}_text',
              messageId: msgId,
              type: 'text',
              text: row.rawText,
            ),
          ];
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // WebSocket message handler
  // --------------------------------------------------------------------------

  void _onWsMessage(AgentWsMessage msg) {
    if (msg is SessionsListMessage) {
      _sessions = msg.sessions
          .where((s) => s.status != AgentSessionStatus.resumable)
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
      final wasWorking = _working[msg.id] ?? false;
      _working[msg.id] = msg.working;
      // Issue #606 — when a session transitions from working to not-working,
      // fire notifications for any messages with notify-on-completion armed.
      if (wasWorking && !msg.working) {
        _fireArmedNotifications(msg.id);
      }
    } else if (msg is OutputMessage) {
      // OPC-M1-3: PTY output buffer removed. Legacy `output` frames still
      // arrive during a transition period; we only use them to clear stuck
      // tracking (same semantics as before).
      final session = _sessions.firstWhereOrNull((s) => s.id == msg.id);
      if (session != null && session.status == AgentSessionStatus.starting) {
        sessionFirstSeenAt.remove(msg.id);
      }
    } else if (msg is MessageUpdatedMessage) {
      _upsertChatMessage(
        sessionId: msg.sessionId,
        messageId: msg.messageId,
        role: msg.role,
      );
    } else if (msg is MessagePartUpdatedMessage) {
      _upsertChatPart(
        messageId: msg.messageId,
        partId: msg.partId,
        type: msg.partType,
        text: msg.text,
        raw: msg.part,
      );
      // OPC-M1-3: record part activity for stuck detection.
      _lastPartActivityAt[msg.sessionId] = DateTime.now();
      // A part arriving means the session is no longer stuck.
      final session = _sessions.firstWhereOrNull((s) => s.id == msg.sessionId);
      if (session != null && session.status == AgentSessionStatus.starting) {
        sessionFirstSeenAt.remove(msg.sessionId);
      }
    } else if (msg is MessagePartDeltaMessage) {
      _appendChatDelta(
        messageId: msg.messageId,
        partId: msg.partId,
        field: msg.field,
        delta: msg.delta,
      );
    } else if (msg is MessageRemovedMessage) {
      _removeChatMessage(
        sessionId: msg.sessionId,
        messageId: msg.messageId,
      );
    } else if (msg is TranscriptAppendMessage) {
      // OPC-M1-3: transcript.append is a legacy bridge event. We keep it
      // for backward compat but it no longer drives the UI render path —
      // the parts-based store (chatMessagesBySession) is the single source.
      // No-op for now; a future cleanup pass can remove the bridge emission.
      // (The PTY output buffer that was cleared here is gone.)
    } else if (msg is WsErrorMessage) {
      // OPC-M1-3: WS error frames become system-role ChatMessages so they
      // appear in the single parts-based render path instead of the deleted
      // _transcriptsBySession render branch.
      final errorMsgId =
          'ws-error-${msg.id}-${DateTime.now().millisecondsSinceEpoch}';
      final chatMsg = ChatMessage(
        id: errorMsgId,
        sessionId: msg.id,
        role: 'system',
        createdAt: DateTime.now(),
      );
      (_chatMessagesBySession[msg.id] ??= []).add(chatMsg);
      _chatPartsByMessage[errorMsgId] = [
        ChatPart(
          id: '${errorMsgId}_text',
          messageId: errorMsgId,
          type: 'text',
          text: 'Error: ${msg.message}',
        ),
      ];
    } else if (msg is SessionUpdatedMessage) {
      // #605 — server pushed a full updated session row. Upsert into the
      // appropriate list based on archivedAt / status.
      final s = msg.session;
      if (s.isArchived) {
        // Move / upsert into archived; remove from active lists.
        _sessions = _sessions.where((x) => x.id != s.id).toList();
        _resumable = _resumable.where((x) => x.id != s.id).toList();
        _archived = _upsertById(_archived, s);
      } else if (s.status == AgentSessionStatus.resumable) {
        _sessions = _sessions.where((x) => x.id != s.id).toList();
        _archived = _archived.where((x) => x.id != s.id).toList();
        _resumable = _upsertById(_resumable, s);
      } else {
        _resumable = _resumable.where((x) => x.id != s.id).toList();
        _archived = _archived.where((x) => x.id != s.id).toList();
        _sessions = _upsertById(_sessions, s);
      }
    } else if (msg is SessionRemovedMessage) {
      // #605 — hard-deleted row; drop from all local caches.
      _sessions = _sessions.where((x) => x.id != msg.id).toList();
      _resumable = _resumable.where((x) => x.id != msg.id).toList();
      _archived = _archived.where((x) => x.id != msg.id).toList();
      _chatMessagesBySession.remove(msg.id);
      _lastPartActivityAt.remove(msg.id);
      sessionFirstSeenAt.remove(msg.id);
      if (_selectedSessionId == msg.id) _selectedSessionId = null;
    } else if (msg is PermissionAskedMessage) {
      final list = _pendingPermissions.putIfAbsent(msg.sessionId, () => []);
      // Deduplicate by permissionId.
      if (!list.any((p) => p.permissionId == msg.permissionId)) {
        list.add(PendingPermission(
          sessionId: msg.sessionId,
          permissionId: msg.permissionId,
          toolName: msg.toolName,
          args: msg.args,
          summary: msg.summary,
        ));
      }
    } else if (msg is PermissionResolvedMessage) {
      _removePendingPermission(msg.sessionId, msg.permissionId);
    } else if (msg is TriggerFiredMessage) {
      _pendingTriggers.add(
        PendingTrigger(
          taskId: msg.taskId,
          taskTitle: msg.taskTitle,
          arrivedAt: DateTime.now(),
        ),
      );
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
  // Parts-based chat reducer (Opencode Desktop port)
  // --------------------------------------------------------------------------

  void _upsertChatMessage({
    required String sessionId,
    required String messageId,
    required String role,
  }) {
    if (sessionId.isEmpty || messageId.isEmpty) return;
    final list = _chatMessagesBySession.putIfAbsent(sessionId, () => []);
    final idx = list.indexWhere((m) => m.id == messageId);
    if (idx >= 0) {
      // Existing message — no-op for now (role doesn't change).
      return;
    }
    list.add(ChatMessage(
      id: messageId,
      sessionId: sessionId,
      role: role,
      createdAt: DateTime.now(),
    ));
  }

  void _upsertChatPart({
    required String messageId,
    required String partId,
    required String type,
    required String text,
    Map<String, dynamic>? raw,
  }) {
    if (messageId.isEmpty || partId.isEmpty) return;
    final list = _chatPartsByMessage.putIfAbsent(messageId, () => []);
    final idx = list.indexWhere((p) => p.id == partId);
    if (idx >= 0) {
      // Re-emit replaces text (the SDK sends the canonical part on update).
      list[idx].text = text;
      if (raw != null) list[idx].mergePart(raw);
    } else {
      final part = ChatPart(
        id: partId,
        messageId: messageId,
        type: type,
        text: text,
      );
      if (raw != null) part.mergePart(raw);
      list.add(part);
    }
  }

  void _appendChatDelta({
    required String messageId,
    required String partId,
    required String field,
    required String delta,
  }) {
    if (field != 'text') return; // ignore non-text fields for now
    if (messageId.isEmpty || partId.isEmpty || delta.isEmpty) return;
    final list = _chatPartsByMessage.putIfAbsent(messageId, () => []);
    final idx = list.indexWhere((p) => p.id == partId);
    if (idx >= 0) {
      list[idx].appendDelta(delta);
    } else {
      // Part announcement may arrive after first delta — create on the fly.
      list.add(ChatPart(
        id: partId,
        messageId: messageId,
        type: 'text',
        text: delta,
      ));
    }
  }

  void _removeChatMessage({
    required String sessionId,
    required String messageId,
  }) {
    _chatMessagesBySession[sessionId]?.removeWhere((m) => m.id == messageId);
    _chatPartsByMessage.remove(messageId);
  }

  // Issue #606 — fire desktop notifications for all armed messages in a session.
  void _fireArmedNotifications(String sessionId) {
    final prefix = '$sessionId:';
    final armed =
        _notifyOnCompletion.where((k) => k.startsWith(prefix)).toList();
    if (armed.isEmpty) return;
    for (final key in armed) {
      _notifyOnCompletion.remove(key);
    }
    _notificationService.showMessageNotification(
      id: sessionId.hashCode & 0x7FFFFFFF,
      title: 'Agent session finished',
      body: 'The agent finished working in the session you were watching.',
    );
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
  /// OPC-M1-3: A session is stuck when:
  ///   - Its status is [AgentSessionStatus.starting].
  ///   - No parts have arrived yet (chatMessagesFor is empty AND
  ///     _lastPartActivityAt has no entry for the session).
  ///   - It has been in the starting state for >30 seconds.
  void _recomputeStuck() {
    const stuckThreshold = Duration(seconds: 30);
    final now = DateTime.now();

    final newStuck = <String>{};
    for (final s in _sessions) {
      if (s.status != AgentSessionStatus.starting) continue;
      final firstSeen = sessionFirstSeenAt[s.id];
      if (firstSeen == null) continue;
      // Has parts arrived?
      final hasParts = (_chatMessagesBySession[s.id]?.isNotEmpty == true) ||
          (_lastPartActivityAt.containsKey(s.id));
      if (hasParts) continue;
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

  bool _disposed = false;

  @override
  void dispose() {
    _disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    _stuckCheckTimer?.cancel();
    _wsSub?.cancel();
    _connectivitySub?.cancel();
    if (_serverListenerAttached) {
      _agentServerController.removeListener(_onServerStateChanged);
    }
    _repository.dispose();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/// Upsert [item] into [list] by id. If a row with the same id exists it is
/// replaced; otherwise [item] is appended.
List<AgentSession> _upsertById(List<AgentSession> list, AgentSession item) {
  final idx = list.indexWhere((s) => s.id == item.id);
  if (idx >= 0) {
    final result = [...list];
    result[idx] = item;
    return result;
  }
  return [...list, item];
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
