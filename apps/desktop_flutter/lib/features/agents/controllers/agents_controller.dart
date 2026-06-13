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

  // OPC-M2-4: Per-session retry state. Non-null when the bridge has relayed
  // a 'retrying' status for the session. Cleared when the next part/message
  // event arrives (retry resolved).
  final Map<String, ({int attempt, String reason})> _retryingBySession = {};

  final List<PendingTrigger> _pendingTriggers = [];

  // -- Permission state (#608) -----------------------------------------------
  // Keyed by sessionId → list of pending permissions.
  final Map<String, List<PendingPermission>> _pendingPermissions = {};

  // OPC-M3-1: Per-session working-tree diff (FileDiff entries from the server).
  // Populated by fetchSessionDiff() and invalidated by session.diff WS events.
  final Map<String, List<Map<String, dynamic>>> _sessionDiffBySession = {};
  final Set<String> _sessionDiffLoading = {};
  // OPC-M3-1: last fetch error per session (null when the most recent fetch
  // succeeded). Lets the Changes tab distinguish an error state from an
  // empty-but-successful diff (acceptance criterion c3).
  final Map<String, String> _sessionDiffError = {};

  // OPC-M3-2: Per-session revert state.
  // true means the session currently has a revert applied (some messages are
  // reverted / dimmed). Cleared after a successful unrevert.
  final Map<String, bool> _sessionReverted = {};

  // OPC-M3-3: Per-session compacting state.
  // true while a summarize call is in-flight (spinner shown in header).
  // Cleared when the compaction part arrives via WS, or on error.
  final Map<String, bool> _sessionCompacting = {};

  // OPC-M3-5: Per-session todo list. Populated by fetchSessionTodos() on
  // selectSession and replaced in-place on todo.updated WS events. Keyed
  // by local session id. An absent entry means no fetch has occurred yet;
  // an empty list means the session has no todos.
  final Map<String, List<Map<String, dynamic>>> _sessionTodosBySession = {};
  // True while a todo fetch is in-flight for the given session id.
  final Set<String> _sessionTodosLoading = {};

  // OPC-M4-1: Pending file attachments per session.
  // Each entry is a FilePart map with keys: type, mime, filename, url (data URI).
  // Cleared after sendInput() sends the parts array.
  final Map<String, List<Map<String, dynamic>>> _pendingAttachmentsBySession =
      {};

  // OPC-M3-6: Child-session navigation state.
  // Non-null when the user has tapped a task chip and navigated into a child
  // session transcript. The UI swaps the main transcript area to the child view.
  // Null = show parent transcript.
  String? _activeChildSessionId;
  String? _activeChildParentSessionId;
  String? _activeChildParentName;

  // Cache of fetched child messages keyed by childSdkId.
  // Entries persist for the lifetime of the app so back-navigation is instant.
  final Map<String, List<AgentSessionMessage>> _childMessagesByChildId = {};

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

  /// OPC-M1-5 — The id of the local session whose SDK backing was reported
  /// gone (HTTP 410) during a resume attempt. Non-null signals the view to
  /// show a "Start fresh" affordance. Cleared by [clearSessionGone].
  String? _sessionGoneId;

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

  /// OPC-M1-5 — The local session id whose SDK backing was gone (HTTP 410)
  /// during resume. Non-null means the view should show a "Start fresh"
  /// affordance. Cleared by [clearSessionGone].
  String? get sessionGoneId => _sessionGoneId;

  /// OPC-M1-5 — Reset the start-fresh affordance state after the user
  /// dismisses the dialog or completes the start-fresh action.
  void clearSessionGone() {
    if (_sessionGoneId != null) {
      _sessionGoneId = null;
      notifyListeners();
    }
  }

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

  /// OPC-M3-3: input token count from the last assistant message for [sessionId].
  ///
  /// Returns null when there are no assistant messages with token data yet.
  /// Used by [_InputAreaState] to decide whether to show the context-usage hint.
  int? lastAssistantInputTokens(String sessionId) {
    final messages = _chatMessagesBySession[sessionId];
    if (messages == null) return null;
    for (final m in messages.reversed) {
      if (m.role != 'user' && m.tokens != null) {
        final raw = m.tokens!['input'];
        if (raw is int) return raw;
        if (raw is num) return raw.toInt();
      }
    }
    return null;
  }

  /// OPC-M2-4: Current retry state for [sessionId], or null if not retrying.
  ({int attempt, String reason})? retryingFor(String sessionId) =>
      _retryingBySession[sessionId];

  /// OPC-M2-4: Running total cost (USD) for [sessionId] = sum of per-message
  /// costs received via message.updated or rehydration. Returns null when no
  /// cost-bearing messages have arrived for the session.
  double? sessionTotalCost(String sessionId) {
    final messages = _chatMessagesBySession[sessionId];
    if (messages == null || messages.isEmpty) return null;
    double total = 0.0;
    bool hasCost = false;
    for (final m in messages) {
      if (m.cost != null) {
        total += m.cost!;
        hasCost = true;
      }
    }
    return hasCost ? total : null;
  }

  /// OPC-M3-1 — FileDiff entries for [sessionId] in the order returned by the
  /// server. Returns an empty list when no diff has been fetched yet.
  List<Map<String, dynamic>> sessionDiffFor(String sessionId) =>
      List.unmodifiable(_sessionDiffBySession[sessionId] ?? const []);

  /// OPC-M3-1 — True while a diff fetch is in-flight for [sessionId].
  bool sessionDiffLoading(String sessionId) =>
      _sessionDiffLoading.contains(sessionId);

  /// OPC-M3-1 — Error message from the most recent diff fetch for [sessionId],
  /// or null when the last fetch succeeded. Drives the Changes tab error state.
  String? sessionDiffErrorFor(String sessionId) => _sessionDiffError[sessionId];

  /// OPC-M3-1 — Fetch (or refresh) the working-tree diff for [sessionId].
  ///
  /// Updates [_sessionDiffBySession] and notifies listeners on completion.
  /// Safe to call multiple times; concurrent calls for the same session are
  /// gated so only one HTTP round-trip is in-flight at a time.
  Future<void> fetchSessionDiff(String sessionId) async {
    if (_sessionDiffLoading.contains(sessionId)) return;
    _sessionDiffLoading.add(sessionId);
    notifyListeners();
    try {
      final entries = await _repository.fetchSessionDiff(sessionId);
      if (_disposed) return;
      _sessionDiffBySession[sessionId] = entries;
      _sessionDiffError.remove(sessionId);
    } catch (e) {
      if (_disposed) return;
      // Non-fatal — keep stale entries and surface the error so the Changes
      // tab can show a distinct error state (c3) with a retry affordance.
      _sessionDiffBySession[sessionId] ??= const [];
      _sessionDiffError[sessionId] = e.toString();
    } finally {
      _sessionDiffLoading.remove(sessionId);
      if (!_disposed) notifyListeners();
    }
  }

  /// OPC-M3-1 — Called when a `session.diff` WS event arrives.
  ///
  /// Triggers a refetch for [sessionId] only — other sessions are unaffected.
  void handleSessionDiffEvent(String sessionId) {
    unawaited(fetchSessionDiff(sessionId));
  }

  // ── OPC-M3-2: revert / unrevert ────────────────────────────────────────────

  /// True when [sessionId] currently has an active revert (messages after the
  /// revert point are dimmed + badged; "Restore reverted changes" banner shown).
  bool sessionIsReverted(String sessionId) =>
      _sessionReverted[sessionId] ?? false;

  /// OPC-M3-2 — Revert the session to the message identified by [messageId].
  ///
  /// On success:
  ///   - marks the session as reverted so messages after the point render dimmed.
  ///   - triggers a Changes-tab diff refetch.
  /// Throws on server error — the view catches and surfaces it.
  Future<void> revertSession(String sessionId, String messageId) async {
    await _repository.revertSession(sessionId, messageId);
    if (_disposed) return;
    _sessionReverted[sessionId] = true;
    notifyListeners();
    unawaited(fetchSessionDiff(sessionId));
  }

  /// OPC-M3-2 — Restore all reverted messages for [sessionId].
  ///
  /// On success:
  ///   - clears the reverted state.
  ///   - triggers a Changes-tab diff refetch.
  /// Throws on server error — the view catches and surfaces it.
  Future<void> unrevertSession(String sessionId) async {
    await _repository.unrevertSession(sessionId);
    if (_disposed) return;
    _sessionReverted.remove(sessionId);
    notifyListeners();
    unawaited(fetchSessionDiff(sessionId));
  }

  /// Test-only: seed the reverted state for [sessionId] without a server round-trip.
  @visibleForTesting
  void setSessionRevertedForTest(String sessionId, bool reverted) {
    if (reverted) {
      _sessionReverted[sessionId] = true;
    } else {
      _sessionReverted.remove(sessionId);
    }
    notifyListeners();
  }

  // ── OPC-M3-3: compaction (summarize) ────────────────────────────────────────

  /// True while a summarize call is in-flight for [sessionId].
  bool isCompacting(String sessionId) => _sessionCompacting[sessionId] ?? false;

  /// OPC-M3-3 — Trigger session compaction (summarize) for [sessionId].
  ///
  /// Shows a spinner in the session header while the call is in-flight.
  /// The spinner clears when a `compaction` part arrives via WS, or on error.
  /// Throws on server error — the view catches and surfaces it.
  Future<void> summarizeSession(String sessionId) async {
    _sessionCompacting[sessionId] = true;
    notifyListeners();
    try {
      await _repository.summarizeSession(sessionId);
    } catch (_) {
      // Clear compacting state on error so the UI doesn't stay stuck.
      if (!_disposed) {
        _sessionCompacting.remove(sessionId);
        notifyListeners();
      }
      rethrow;
    }
    // Compacting state cleared when the compaction part arrives via WS
    // (handled in _appendChatPart for type='compaction'). If for some reason
    // the part never arrives, the state is kept until the session is re-selected.
    // This is acceptable: the spinner is a progress hint, not a gate.
  }

  /// Test-only: seed the compacting state for [sessionId] without a server round-trip.
  @visibleForTesting
  void setCompactingForTest(String sessionId, bool compacting) {
    if (compacting) {
      _sessionCompacting[sessionId] = true;
    } else {
      _sessionCompacting.remove(sessionId);
    }
    notifyListeners();
  }

  // ── OPC-M3-5: todo list ────────────────────────────────────────────────────

  /// Current todo list for [sessionId]. Empty list when no todos or not yet
  /// fetched. Returns an unmodifiable view.
  List<Map<String, dynamic>> sessionTodosFor(String sessionId) =>
      List.unmodifiable(_sessionTodosBySession[sessionId] ?? const []);

  /// True while a todo fetch is in-flight for [sessionId].
  bool sessionTodosLoading(String sessionId) =>
      _sessionTodosLoading.contains(sessionId);

  // ── OPC-M4-2: session fork ────────────────────────────────────────────────

  /// OPC-M4-2 — Fork the session at [messageId], creating a new session that
  /// starts from that point in the transcript.
  ///
  /// On success:
  ///   - The forked session is prepended to [_sessions] (optimistic insert
  ///     so it appears immediately; the 201 REST response is the authority).
  ///   - The fork is immediately selectable via [selectSession].
  /// Throws on server error — the view catches and surfaces it.
  Future<void> forkSession(String sessionId, String messageId) async {
    final forked = await _repository.forkSession(sessionId, messageId);
    if (_disposed) return;
    // Insert at the front so the new fork is visible immediately.
    if (!_sessions.any((s) => s.id == forked.id)) {
      _sessions = [forked, ..._sessions];
    }
    notifyListeners();
  }

  // ── OPC-M3-6: child-session navigation ────────────────────────────────────

  /// The SDK session id of the currently active child session, or null when
  /// the user is viewing the parent transcript.
  String? get activeChildSessionId => _activeChildSessionId;

  /// The local session id of the parent whose task chip was tapped.
  String? get activeChildParentSessionId => _activeChildParentSessionId;

  /// The display name of the parent session for the breadcrumb.
  String? get activeChildParentName => _activeChildParentName;

  /// Messages for the child session identified by [childSdkId].
  /// Returns an empty list when not yet fetched.
  List<AgentSessionMessage> childMessagesFor(String childSdkId) =>
      List.unmodifiable(_childMessagesByChildId[childSdkId] ?? const []);

  /// Open a child session transcript by fetching its messages from the server.
  ///
  /// Sets [activeChildSessionId] so the view swaps to the child transcript area.
  /// Child messages are cached — subsequent opens of the same child are instant.
  /// Does NOT modify [_sessions] or [_resumable] — children never enter the
  /// sidebar lists.
  Future<void> openChildSession({
    required String parentSessionId,
    required String parentSessionName,
    required String childSdkId,
  }) async {
    // Use cache if available.
    if (!_childMessagesByChildId.containsKey(childSdkId)) {
      try {
        final messages = await _repository.fetchChildMessages(
          parentSessionId,
          childSdkId,
        );
        if (_disposed) return;
        _childMessagesByChildId[childSdkId] = messages;
      } catch (_) {
        if (_disposed) return;
        // Non-fatal: show empty child transcript rather than crashing.
        _childMessagesByChildId[childSdkId] = const [];
      }
    }
    _activeChildSessionId = childSdkId;
    _activeChildParentSessionId = parentSessionId;
    _activeChildParentName = parentSessionName;
    notifyListeners();
  }

  /// Navigate back to the parent transcript.
  ///
  /// Clears the active child session WITHOUT refetching the parent — the parent's
  /// chat store is preserved in-memory, so scroll context and messages remain intact.
  void closeChildSession() {
    if (_activeChildSessionId == null) return;
    _activeChildSessionId = null;
    _activeChildParentSessionId = null;
    _activeChildParentName = null;
    notifyListeners();
  }

  /// OPC-M3-5 — Fetch (or refresh) the todo list for [sessionId].
  ///
  /// Concurrent calls for the same session are gated — only one HTTP round-trip
  /// in-flight at a time. Updates [_sessionTodosBySession] and notifies on
  /// completion.
  Future<void> fetchSessionTodos(String sessionId) async {
    if (_sessionTodosLoading.contains(sessionId)) return;
    _sessionTodosLoading.add(sessionId);
    notifyListeners();
    try {
      final todos = await _repository.fetchSessionTodos(sessionId);
      if (_disposed) return;
      _sessionTodosBySession[sessionId] = todos;
    } catch (e) {
      if (_disposed) return;
      // Non-fatal: keep stale entries on error (empty list on first fetch).
      _sessionTodosBySession[sessionId] ??= const [];
    } finally {
      _sessionTodosLoading.remove(sessionId);
      if (!_disposed) notifyListeners();
    }
  }

  /// Test-only: seed the todo state for [sessionId] without a HTTP round-trip.
  @visibleForTesting
  void setSessionTodosForTest(
    String sessionId,
    List<Map<String, dynamic>> todos,
  ) {
    _sessionTodosBySession[sessionId] = List.of(todos);
    notifyListeners();
  }

  /// Test-only: inject a [ChatMessage] directly into the chat store.
  @visibleForTesting
  void setMessageForTest(ChatMessage message) {
    final existing = _chatMessagesBySession[message.sessionId] ?? [];
    final idx = existing.indexWhere((m) => m.id == message.id);
    if (idx >= 0) {
      existing[idx] = message;
    } else {
      _chatMessagesBySession[message.sessionId] = [...existing, message];
    }
    notifyListeners();
  }

  /// Test-only: seed a diff result directly without a HTTP round-trip.
  @visibleForTesting
  void setSessionDiffForTest(
    String sessionId,
    List<Map<String, dynamic>> entries,
  ) {
    _sessionDiffBySession[sessionId] = List.of(entries);
    notifyListeners();
  }

  /// Test-only: inject a [ChatPart] directly into the parts store.
  @visibleForTesting
  void setChatPartForTest(ChatPart part) {
    final existing = _chatPartsByMessage[part.messageId] ?? [];
    final idx = existing.indexWhere((p) => p.id == part.id);
    if (idx >= 0) {
      existing[idx] = part;
    } else {
      _chatPartsByMessage[part.messageId] = [...existing, part];
    }
    notifyListeners();
  }

  /// Test-only: seed the slash-command cache for [sessionId] without a
  /// network round-trip.
  @visibleForTesting
  void setSlashCommandsForTest(String sessionId, List<SlashCommand> commands) {
    _commandsBySession[sessionId] = commands;
    notifyListeners();
  }

  List<PendingTrigger> get pendingTriggers =>
      List.unmodifiable(_pendingTriggers);

  /// Pending permissions for [sessionId], in arrival order.
  List<PendingPermission> pendingPermissionsFor(String sessionId) =>
      List.unmodifiable(_pendingPermissions[sessionId] ?? const []);

  // --------------------------------------------------------------------------
  // OPC-M4-1: Pending attachment management
  // --------------------------------------------------------------------------

  /// OPC-M4-1: Returns the current list of pending file attachments for
  /// [sessionId]. Each entry is a FilePart map with keys: type, mime,
  /// filename, url (data:URI).
  List<Map<String, dynamic>> pendingAttachmentsFor(String sessionId) =>
      List.unmodifiable(_pendingAttachmentsBySession[sessionId] ?? const []);

  /// OPC-M4-1: Add a file attachment to the pending list for [sessionId].
  /// [part] must be a FilePart map: {type:'file', mime, filename, url}.
  void addPendingAttachment(String sessionId, Map<String, dynamic> part) {
    final list = _pendingAttachmentsBySession[sessionId] ?? [];
    _pendingAttachmentsBySession[sessionId] = [...list, part];
    notifyListeners();
  }

  /// OPC-M4-1: Remove the attachment at [index] from the pending list for
  /// [sessionId]. If [index] is out of bounds, this is a no-op.
  void removePendingAttachment(String sessionId, int index) {
    final list = _pendingAttachmentsBySession[sessionId];
    if (list == null || index < 0 || index >= list.length) return;
    final updated = [...list]..removeAt(index);
    _pendingAttachmentsBySession[sessionId] = updated;
    notifyListeners();
  }

  /// OPC-M4-1: Clear all pending attachments for [sessionId].
  void clearPendingAttachments(String sessionId) {
    _pendingAttachmentsBySession.remove(sessionId);
    notifyListeners();
  }

  /// Test-only: seed the pending attachments for [sessionId] without UI.
  @visibleForTesting
  void setPendingAttachmentsForTest(
    String sessionId,
    List<Map<String, dynamic>> parts,
  ) {
    _pendingAttachmentsBySession[sessionId] = List.of(parts);
    notifyListeners();
  }

  /// Test-only: set the active session id without triggering HTTP round-trips.
  ///
  /// If [session] is provided, it is also added to [_sessions] so that
  /// [selectedSession] resolves to a non-null value. Callers that only need
  /// to set the selection index (e.g. when [_sessions] is already populated
  /// externally) may omit [session].
  @visibleForTesting
  void setActiveSessionForTest(String sessionId, [AgentSession? session]) {
    _selectedSessionId = sessionId;
    if (session != null && !_sessions.any((s) => s.id == session.id)) {
      _sessions = [..._sessions, session];
    }
    notifyListeners();
  }

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

  /// OPC-M3-4 — Slash-commands for a specific [sessionId].
  /// Used by the send path to determine whether the submitted text is a known
  /// command (→ structured dispatch) or plain text (→ session.input).
  List<SlashCommand> slashCommandsFor(String sessionId) =>
      List.unmodifiable(_commandsBySession[sessionId] ?? const []);

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

      // OPC-M1-5: rehydrate the transcript from the REST endpoint immediately
      // after a successful resume so prior conversation history is visible
      // before any new WS messages arrive. One fetch, same path as selectSession.
      try {
        final result = await _repository.getSession(id);
        _rehydrateChatMessages(id, result.messages);
        notifyListeners();
      } catch (_) {
        // Rehydrate failure is non-fatal — the session is already resumed;
        // history will fill in via WS events as they arrive.
      }
    } catch (e) {
      if (e is AppError && e.statusCode == 410) {
        // OPC-M1-5: SDK session is gone — surface the start-fresh affordance.
        _sessionGoneId = id;
        _error = e.message;
        _lastErrorStatus = e.statusCode;
      } else if (e is AppError) {
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
    // OPC-M4-1: merge explicit attachments param with any controller-held
    // pending attachments (the latter are added via addPendingAttachment).
    final controllerPending = List<Map<String, dynamic>>.of(
        _pendingAttachmentsBySession[sessionId] ?? []);
    final allAttachments = [
      ...?attachments,
      ...controllerPending,
    ];
    final useParts = allAttachments.isNotEmpty;
    _repository.send({
      'type': 'session.input',
      'id': sessionId,
      // OPC-M4-1: when attachments exist, send a structured parts array; the
      // backend forwards the full parts array (including FileParts with data
      // URIs) verbatim to the SDK promptAsync call.
      if (useParts)
        'parts': [
          {'type': 'text', 'text': data},
          ...allAttachments,
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
    // OPC-M4-1: clear pending attachments after send.
    if (controllerPending.isNotEmpty) {
      _pendingAttachmentsBySession.remove(sessionId);
    }
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
    // Build the parts list for the optimistic insert: text first, then any
    // file parts so the user bubble renders thumbnails/chips immediately.
    final optimisticParts = <ChatPart>[
      ChatPart(
        id: '${optimisticMsgId}_text',
        messageId: optimisticMsgId,
        type: 'text',
        text: data,
      ),
      // OPC-M4-1: add file parts for each attachment.
      for (var i = 0; i < allAttachments.length; i++)
        ChatPart(
          id: '${optimisticMsgId}_file_$i',
          messageId: optimisticMsgId,
          type: 'file',
          fileMime: allAttachments[i]['mime'] as String?,
          fileFilename: allAttachments[i]['filename'] as String?,
          fileUrl: allAttachments[i]['url'] as String?,
        ),
    ];
    _chatPartsByMessage[optimisticMsgId] = optimisticParts;
    notifyListeners();
  }

  /// OPC-M3-4 — Send a structured slash-command dispatch via the
  /// `session.command` WS frame.
  ///
  /// Use this when the user selects a command from the slash-command popover.
  /// The WS gateway will call `opencodeClient.dispatchCommand(sdkId, command,
  /// arguments)` on the server side. The server streams the response back via
  /// the event stream exactly as it would for a `session.input` prompt.
  ///
  /// Unlike `sendInput`, this does NOT send a `session.input` frame, so the
  /// server does NOT run the text through the promptAsync path. The command
  /// name + args are dispatched through the SDK's structured command path.
  ///
  /// An optimistic `ChatMessage` with role `'command'` is inserted into the
  /// chat store immediately so the invocation appears in the transcript before
  /// the server responds.
  void sendCommand(String sessionId, String command, String args) {
    _repository.send({
      'type': 'session.command',
      'id': sessionId,
      'command': command,
      'arguments': args,
    });
    // OPC-M3-4: optimistic insert — show the command invocation in the
    // transcript immediately with a distinct 'command' role.
    final optimisticMsgId =
        'optimistic-cmd-${DateTime.now().millisecondsSinceEpoch}';
    final invocationText = args.isEmpty ? '/$command' : '/$command $args';
    final optimisticMsg = ChatMessage(
      id: optimisticMsgId,
      sessionId: sessionId,
      role: 'command',
      createdAt: DateTime.now(),
    );
    (_chatMessagesBySession[sessionId] ??= []).add(optimisticMsg);
    _chatPartsByMessage[optimisticMsgId] = [
      ChatPart(
        id: '${optimisticMsgId}_text',
        messageId: optimisticMsgId,
        type: 'text',
        text: invocationText,
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
    // OPC-M3-5: fetch the todo list for this session on first select.
    unawaited(fetchSessionTodos(id));
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
          // OPC-M2-4: propagate cost/tokens from REST rows.
          cost: row.cost,
          tokens: row.tokens,
        );
        (_chatMessagesBySession[sessionId] ??= []).add(chatMsg);
        existingMsgIds.add(msgId);
      } else {
        // OPC-M2-4: if the message already exists (from WS streaming) but has
        // no cost yet, fill it in from the REST row.
        final existingIdx = (_chatMessagesBySession[sessionId] ?? [])
            .indexWhere((m) => m.id == msgId);
        if (existingIdx >= 0) {
          final existing = _chatMessagesBySession[sessionId]![existingIdx];
          if (existing.cost == null && row.cost != null) {
            existing.cost = row.cost;
          }
          if (existing.tokens == null && row.tokens != null) {
            existing.tokens = row.tokens;
          }
        }
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
      // OPC-M2-4: handle retrying status.
      if (msg.isRetrying) {
        _retryingBySession[msg.id] = (
          attempt: msg.attempt ?? 1,
          reason: msg.reason ?? '',
        );
      } else {
        // Non-retry status (idle/busy) clears any prior retry state.
        _retryingBySession.remove(msg.id);
      }
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
        cost: msg.cost,
        tokens: msg.tokens,
      );
    } else if (msg is MessagePartUpdatedMessage) {
      _upsertChatPart(
        messageId: msg.messageId,
        partId: msg.partId,
        type: msg.partType,
        text: msg.text,
        raw: msg.part,
      );
      // OPC-M2-4: a real part arriving means the retry resolved — clear state.
      _retryingBySession.remove(msg.sessionId);
      // OPC-M3-3: a compaction part arriving means the summarize completed.
      if (msg.partType == 'compaction') {
        _sessionCompacting.remove(msg.sessionId);
      }
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
    } else if (msg is SessionDiffMessage) {
      // OPC-M3-1: session.diff event — refetch diff for the affected session only.
      handleSessionDiffEvent(msg.id);
      return; // handleSessionDiffEvent calls notifyListeners() asynchronously.
    } else if (msg is SessionTodoUpdatedMessage) {
      // OPC-M3-5: todo.updated event — replace the session's todo state in-place.
      // State is keyed per session; an update for session B must not affect A.
      _sessionTodosBySession[msg.sessionId] = List.of(msg.todos);
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
    double? cost,
    Map<String, dynamic>? tokens,
  }) {
    if (sessionId.isEmpty || messageId.isEmpty) return;
    final list = _chatMessagesBySession.putIfAbsent(sessionId, () => []);
    final idx = list.indexWhere((m) => m.id == messageId);
    if (idx >= 0) {
      // OPC-M2-4: update cost/tokens on existing message when they arrive.
      if (cost != null) list[idx].cost = cost;
      if (tokens != null) list[idx].tokens = tokens;
      return;
    }
    list.add(ChatMessage(
      id: messageId,
      sessionId: sessionId,
      role: role,
      createdAt: DateTime.now(),
      cost: cost,
      tokens: tokens,
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
    if (messageId.isEmpty || partId.isEmpty || delta.isEmpty) return;

    final list = _chatPartsByMessage.putIfAbsent(messageId, () => []);
    final idx = list.indexWhere((p) => p.id == partId);

    if (idx >= 0) {
      // Part exists — route by field name.
      // Both 'text' and 'reasoning' parts carry their content in the 'text'
      // field; the delta field value tells us which property to append to.
      if (field == 'text') {
        // Appends to the part's text regardless of part.type (text or reasoning).
        list[idx].appendDelta(delta);
      } else {
        // Unknown field — retain the part as-is and log for observability.
        // Never silently drop.
        debugPrint(
          '[AgentsController] _appendChatDelta: unknown field "$field" '
          'for partId=$partId (type=${list[idx].type}). Delta retained but '
          'not applied. delta=${delta.length > 40 ? delta.substring(0, 40) : delta}',
        );
      }
    } else {
      // Part announcement has not arrived yet — create on the fly.
      if (field == 'text') {
        // Default to 'text' type; the part.updated event will correct it later.
        list.add(ChatPart(
          id: partId,
          messageId: messageId,
          type: 'text',
          text: delta,
        ));
      } else {
        // Unknown field with no existing part — log and skip creation.
        debugPrint(
          '[AgentsController] _appendChatDelta: unknown field "$field" '
          'for partId=$partId (no existing part). Delta retained, part not '
          'created. delta=${delta.length > 40 ? delta.substring(0, 40) : delta}',
        );
      }
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

  /// Test-only: directly forward a [AgentWsMessage] to the WS message handler.
  /// Avoids calling [initialize()] (which starts a periodic stuck-check timer)
  /// while still exercising the full WS message dispatch path.
  @visibleForTesting
  void handleWsMessageForTest(AgentWsMessage msg) => _onWsMessage(msg);

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
