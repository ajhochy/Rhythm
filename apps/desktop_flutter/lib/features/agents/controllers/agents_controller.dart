import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../app/core/agents/agent_server_controller.dart';
import '../../../app/core/errors/app_error.dart';
import '../../../app/core/notifications/local_notification_service.dart';
import '../../notifications/controllers/notifications_controller.dart';
import '../../settings/data/anthropic_accounts_data_source.dart'
    show AnthropicAccountsLabelCache;
import '../data/agent_models_data_source.dart';
import '../data/commands_data_source.dart';
import '../models/agent_model_route.dart';
import '../models/catalog_model_entry.dart';
import '../models/agent_session.dart';
import '../models/agent_session_connectivity.dart';
import '../models/agent_session_message.dart';
import '../models/agent_ws_message.dart';
import '../models/chat_models.dart';
// AgentInfo is defined in chat_models.dart (OPC-M4-4).
import '../repositories/agents_repository.dart';
import 'pty_terminal_session.dart';

/// #861 — one hop of nested child-session navigation.
///
/// [fetchParentId] is the id passed to the repository to fetch this frame's
/// messages/children — the top-level parent's LOCAL session id for the first
/// hop, or the enclosing child's own SDK session id for any deeper hop
/// (grandchild+). [childSdkId] is this frame's own SDK session id (used both
/// as the cache key and, for a deeper nested tap, as the next frame's
/// [fetchParentId]). [parentDisplayName] is shown in the breadcrumb this
/// frame navigates back to. [displayName] is THIS frame's own display name
/// (the tapped chip's description) — used as the breadcrumb target for any
/// further-nested (grandchild+) chip tapped inside this child's transcript.
class _ChildFrame {
  const _ChildFrame({
    required this.fetchParentId,
    required this.childSdkId,
    required this.parentDisplayName,
    required this.displayName,
  });

  final String fetchParentId;
  final String childSdkId;
  final String parentDisplayName;
  final String displayName;
}

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

/// #1025 (USO A2) — session-list category scope. Maps to the server
/// `GET /agent-sessions?scope=` query param. `chats` is the default and
/// `no-scope === scope=chats`. [menuLabel] is the full dropdown-item label;
/// [headerLabel] is the compact uppercased label shown at the list header.
enum AgentSessionScope {
  chats('chats', 'Chats', 'CHATS'),
  scheduled('scheduled', 'Scheduled Tasks', 'SCHEDULED'),
  selfImprovement(
    'self_improvement',
    'Background self-improvement',
    'SELF-IMPROVE',
  );

  const AgentSessionScope(this.wireValue, this.menuLabel, this.headerLabel);

  final String wireValue;
  final String menuLabel;
  final String headerLabel;
}

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

/// Per-message token usage broken out for the inspector Context tab. `cache`
/// in the raw tokens map is split into [cacheRead] / [cacheWrite] (it may also
/// arrive as a single int read count — see [AgentsController.sessionTokenBreakdown]).
class TokenBreakdown {
  const TokenBreakdown({
    this.input = 0,
    this.output = 0,
    this.reasoning = 0,
    this.cacheRead = 0,
    this.cacheWrite = 0,
  });
  final int input;
  final int output;
  final int reasoning;
  final int cacheRead;
  final int cacheWrite;
}

class AgentsController extends ChangeNotifier with WidgetsBindingObserver {
  AgentsController(
    this._repository,
    this._agentServerController,
    this._notificationService,
    this._notificationsController, {
    AgentModelsDataSource? modelsDataSource,
    // #745: optional resolver that returns the manager profile's ocAgent name.
    // When provided, new sessions default to the manager's agent rather than
    // the SDK built-in 'build'. Falls back to null (SDK default) if absent or
    // if the resolver returns null (e.g. no manager profile configured yet).
    String? Function()? managerAgentNameResolver,
    // #890: optional resolver that returns the app-level "Default profile"
    // override configured via the Agent Profile manager sheet
    // (DefaultAgentProfileService.defaultOcAgent). When it returns a
    // non-null ocAgent that matches an authorized catalog entry, new
    // sessions default to it instead of Secretary. Distinct from
    // [managerAgentNameResolver] — that resolver drives which agent handles
    // manager-preamble routing; this one is a pure user preference for the
    // default new-session profile.
    String? Function()? configuredDefaultAgentResolver,
  })  : _modelsDataSource = modelsDataSource ?? AgentModelsDataSource(),
        _commandsDataSource = CommandsDataSource(),
        _managerAgentNameResolver = managerAgentNameResolver,
        _configuredDefaultAgentResolver = configuredDefaultAgentResolver;

  final AgentsRepository _repository;
  final AgentModelsDataSource _modelsDataSource;
  final CommandsDataSource _commandsDataSource;
  final AgentServerController _agentServerController;
  final LocalNotificationService _notificationService;
  final NotificationsController _notificationsController;
  // #745: resolves the manager profile's opencode agent name at call time.
  // Nullable so tests and legacy construction sites can omit it safely.
  final String? Function()? _managerAgentNameResolver;
  // #890: resolves the user-configured default profile's ocAgent at call
  // time. Nullable so tests and legacy construction sites can omit it safely.
  final String? Function()? _configuredDefaultAgentResolver;

  AppLifecycleState _lifecycleState = AppLifecycleState.resumed;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _lifecycleState = state;
  }

  AgentsLoadStatus _status = AgentsLoadStatus.idle;
  String? _error;
  int? _lastErrorStatus;
  bool _reconnecting = false;

  /// True while an instant-create session call is in-flight (OPC-#713).
  /// The session-list view shows an optimistic loading row while this is set.
  bool _creating = false;

  List<AgentSession> _sessions = [];
  List<AgentSession> _resumable = [];
  List<AgentSession> _archived = [];

  /// #1025 (USO A2) — active session-list category scope. Sent as the
  /// `?scope=` query param on every [load]. Defaults to [AgentSessionScope.chats].
  AgentSessionScope _scope = AgentSessionScope.chats;
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

  /// Message ids whose parts the CLIENT authored optimistically (user input /
  /// slash commands). The client already knows this content exactly, so the
  /// server's echo of the same parts must NOT be re-added — otherwise the
  /// user's text renders twice inside the one (reconciled) bubble.
  final Set<String> _clientAuthoredMessageIds = {};

  /// OCU-05 (#1046): message ids sent while the session was already working, so
  /// the engine queues them. The user bubble shows a subtle "queued" chip until
  /// the engine's `message.updated` reconciles the optimistic insert (promoting
  /// its id in [_upsertChatMessage]), at which point the id is cleared.
  final Set<String> _queuedMessageIds = {};

  /// OCU-05: true while [messageId]'s bubble should show the "queued" chip.
  bool isMessageQueued(String messageId) =>
      _queuedMessageIds.contains(messageId);

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

  // -- Question state (AskUserQuestion handshake) ----------------------------
  // Authoritative question payload from the `question.asked` frame, keyed by
  // `${sessionId}:${callId}`. Lets QuestionToolCard render options even if the
  // tool-part input lagged (fixes the stuck "Waiting for question…" card).
  final Map<String, List<dynamic>> _questionsByCallId = {};
  // callIds whose question has been resolved (answered/dismissed), so the card
  // can stop offering an answer even when resolved by another client/agent.
  final Set<String> _resolvedQuestionCallIds = {};

  // #815: ask-notification dedupe set. Keyed by the per-ask key
  // (`perm:$sessionId:$permissionId` / `q:$sessionId:$requestId`). Guarantees at
  // most one native notification per pending ask; cleared when the ask resolves.
  final Set<String> _notifiedAsks = {};

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

  // Issue #862: Per-session "Memories used in this reply" provenance.
  // Populated by fetchMemoryProvenance() on selectSession. Keyed by local
  // session id. An absent entry means no fetch has occurred yet.
  final Map<String, Map<String, dynamic>> _sessionMemoryProvenanceBySession =
      {};

  // OCU-22 (#1063): per-session VCS info ({branch}) and working-tree status
  // (changed-file entries). An absent entry means no fetch has occurred yet;
  // a null [_vcsInfoBySession] value means the last fetch succeeded but the
  // directory isn't a git repo (no branch) — the badge stays hidden either way.
  final Map<String, Map<String, dynamic>?> _vcsInfoBySession = {};
  final Map<String, List<Map<String, dynamic>>> _vcsStatusBySession = {};
  final Set<String> _vcsInfoLoading = {};

  // OCU-23 (#1064): per-session, per-mode ('git' | 'branch') VCS diff entries
  // for the Changes-tab scope toggle. Keyed by '$sessionId:$mode'.
  final Map<String, List<Map<String, dynamic>>> _vcsDiffByKey = {};
  final Set<String> _vcsDiffLoading = {};
  final Map<String, String> _vcsDiffError = {};

  // OCU-25 (#1066): true while a "Prepare project for agents" (session.init)
  // call is in-flight for the given session id.
  final Map<String, bool> _sessionInitializing = {};

  // OPC-M4-1: Pending file attachments per session.
  // Each entry is a FilePart map with keys: type, mime, filename, url (data URI).
  // Cleared after sendInput() sends the parts array.
  final Map<String, List<Map<String, dynamic>>> _pendingAttachmentsBySession =
      {};

  // OPC-M4-4: Per-session agent selection state.
  // Available agents fetched from GET /agent-sessions/agents, keyed by sessionId.
  // An absent entry means no fetch has occurred yet for that session.
  final Map<String, List<AgentInfo>> _availableAgentsBySession = {};
  static const int _transcriptPageSize = 50;
  final Map<String, String?> _olderTranscriptCursorBySession = {};
  final Map<String, bool> _hasOlderTranscriptBySession = {};
  final Set<String> _olderTranscriptLoading = {};
  // Currently selected agent name per session. Null = SDK default (build).
  // Persists for the app run (not persisted to the DB — see spec).
  final Map<String, String?> _selectedAgentBySession = {};

  // OPC-M3-6 / #861: Child-session navigation state.
  // A STACK of navigation frames, one per hop of nested delegation (parent →
  // orchestrator → specialist → …). The top of the stack is the child session
  // currently shown in place of the parent transcript; an empty stack means
  // "show the parent transcript". Each [closeChildSession] call pops exactly
  // one frame, so returning from a grandchild lands on its immediate parent
  // (the orchestrator), not the top-level session — matching the breadcrumb
  // affordance required by #861.
  final List<_ChildFrame> _childStack = [];

  // Cache of fetched child messages keyed by childSdkId.
  // Entries persist for the lifetime of the app so back-navigation is instant.
  final Map<String, List<AgentSessionMessage>> _childMessagesByChildId = {};

  // childSdkIds whose first message fetch is currently in flight — drives a
  // loading spinner in ChildTranscriptView so the (slow) first open isn't a
  // frozen click followed by a flash of "No messages".
  final Set<String> _loadingChildIds = <String>{};

  /// True while [openChildSession]'s first fetch for [childSdkId] is in flight.
  bool isChildLoading(String childSdkId) =>
      _loadingChildIds.contains(childSdkId);

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

  // --------------------------------------------------------------------------
  // #910 — collapsed subagent groups in the session list tree (in-memory only)
  // --------------------------------------------------------------------------

  /// Parent session ids whose child (subagent) rows are collapsed to a single
  /// summary line in the session list. In-memory only — resets on relaunch,
  /// same tier as other pure view-state (e.g. `_resumableSectionExpanded`).
  final Set<String> _collapsedParentSessions = {};

  bool isParentSessionCollapsed(String parentId) =>
      _collapsedParentSessions.contains(parentId);

  void toggleParentSessionCollapsed(String parentId) {
    if (!_collapsedParentSessions.add(parentId)) {
      _collapsedParentSessions.remove(parentId);
    }
    notifyListeners();
  }

  /// Collapse (or expand) every parent id in [parentIds] at once — backs the
  /// session list's "collapse all" / "expand all" toggle.
  void setAllParentSessionsCollapsed(
    Iterable<String> parentIds,
    bool collapsed,
  ) {
    if (collapsed) {
      _collapsedParentSessions.addAll(parentIds);
    } else {
      _collapsedParentSessions.removeAll(parentIds);
    }
    notifyListeners();
  }

  // --------------------------------------------------------------------------
  // Inspector panel collapse state (persisted via shared_preferences)
  // --------------------------------------------------------------------------
  static const _inspectorCollapsedKey = 'agents.inspector.collapsed';
  // #905 — default to collapsed until a persisted preference says otherwise.
  bool _panelCollapsed = true;

  static const _inspectorWidthKey = 'agents.inspector.width';
  static const double _kDefaultPanelWidth = 320;
  static const double _kMinPanelWidth = 280;
  static const double _kMaxPanelWidth = 640;
  double _panelWidth = _kDefaultPanelWidth;

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

  /// True while an instant-create session call is in-flight (OPC-#713).
  bool get isCreating => _creating;

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

  /// #1025 (USO A2) — the active session-list category scope.
  AgentSessionScope get scope => _scope;
  List<AgentSession> get archived => List.unmodifiable(_archived);
  String? get selectedSessionId => _selectedSessionId;

  AgentSession? get selectedSession =>
      _sessions.firstWhereOrNull((s) => s.id == _selectedSessionId) ??
      _resumable.firstWhereOrNull((s) => s.id == _selectedSessionId);

  /// #867 — Look up any known session (active, resumable, or archived) by id.
  /// Used to read a session's OWN resolved agent identity for the footer and
  /// send path, independent of which session is currently selected.
  AgentSession? _sessionById(String sessionId) =>
      _sessions.firstWhereOrNull((s) => s.id == sessionId) ??
      _resumable.firstWhereOrNull((s) => s.id == sessionId) ??
      _archived.firstWhereOrNull((s) => s.id == sessionId);

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

  /// Issue #718 — Cumulative input-token count for [sessionId].
  ///
  /// Sums the `input` field from every [ChatMessage.tokens] map in the session,
  /// across all roles (user messages typically have null tokens; assistant
  /// messages carry the bulk of the count). Returns 0 when no messages with
  /// token data exist yet.
  ///
  /// This is the "tokens used" value shown in the Context tab's usage gauge.
  /// Unlike [lastAssistantInputTokens] — which returns the last assistant
  /// message's token count and is used for the near-composer threshold hint —
  /// this method accumulates the entire conversation history.
  int sessionTotalInputTokens(String sessionId) {
    final messages = _chatMessagesBySession[sessionId];
    if (messages == null) return 0;
    var total = 0;
    for (final m in messages) {
      final tokens = m.tokens;
      if (tokens == null) continue;
      final raw = tokens['input'];
      if (raw is int) {
        total += raw;
      } else if (raw is num) {
        total += raw.toInt();
      }
    }
    return total;
  }

  /// OPC-#718: current context occupancy for [sessionId] — the MOST RECENT
  /// turn's prompt size (input + cached input), which is how full the model's
  /// context window actually is right now.
  ///
  /// This is NOT a sum across messages: each turn re-reads the entire growing
  /// context, so summing per-turn `input` over-counts wildly (it showed
  /// 3514.3k / 200k — 100% — for a conversation actually using ~46k). Output is
  /// excluded — the gauge reflects prompt occupancy, not generated tokens.
  int sessionContextTokens(String sessionId) {
    final messages = _chatMessagesBySession[sessionId];
    if (messages == null) return 0;
    int asInt(Object? v) => v is num ? v.toInt() : 0;
    for (final m in messages.reversed) {
      final t = m.tokens;
      if (t == null) continue;
      final cacheRaw = t['cache'];
      final cache = cacheRaw is num
          ? cacheRaw.toInt()
          : (cacheRaw is Map
              ? ((cacheRaw['read'] as num? ?? 0) +
                      (cacheRaw['write'] as num? ?? 0))
                  .toInt()
              : 0);
      final total = asInt(t['input']) + cache;
      if (total > 0) return total;
    }
    return 0;
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

  /// Inspector Context tab: token usage from the latest message in [sessionId]
  /// that carries a tokens map. `cache` may be an int (read count) or a
  /// `{read, write}` map. Returns an all-zero [TokenBreakdown] when no token
  /// data exists for the session.
  TokenBreakdown sessionTokenBreakdown(String sessionId) {
    final messages = _chatMessagesBySession[sessionId];
    if (messages == null) return const TokenBreakdown();
    int asInt(Object? v) => v is num ? v.toInt() : 0;
    for (final m in messages.reversed) {
      final t = m.tokens;
      if (t == null) continue;
      final cacheRaw = t['cache'];
      int cacheRead = 0;
      int cacheWrite = 0;
      if (cacheRaw is Map) {
        cacheRead = asInt(cacheRaw['read']);
        cacheWrite = asInt(cacheRaw['write']);
      } else if (cacheRaw is num) {
        cacheRead = cacheRaw.toInt();
      }
      return TokenBreakdown(
        input: asInt(t['input']),
        output: asInt(t['output']),
        reasoning: asInt(t['reasoning']),
        cacheRead: cacheRead,
        cacheWrite: cacheWrite,
      );
    }
    return const TokenBreakdown();
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

  /// #720 — Called when a `session.compacted` WS event arrives.
  ///
  /// opencode signals compaction completion with `session.compacted` (NOT a
  /// live `compaction` message-part), so without this the "Conversation
  /// compacted" divider only appeared on a fresh reload. On the event we:
  ///   1. clear the compacting spinner (idempotent with summarizeSession's
  ///      POST-success clear), and
  ///   2. rehydrate the session by re-fetching its messages — the persisted
  ///      CompactionPart then renders as the divider, and the context gauge
  ///      reflects the post-compaction tokens.
  ///
  /// Scoped to [sessionId] only; other sessions are unaffected.
  void handleSessionCompactedEvent(String sessionId) {
    if (sessionId.isEmpty) return;
    _sessionCompacting.remove(sessionId);
    notifyListeners();
    unawaited(rehydrateSessionMessages(sessionId));
  }

  /// #720 — Re-fetch the structured messages for [sessionId] from REST and
  /// merge them into the chat store via [_rehydrateChatMessages]. Same path as
  /// [selectSession]'s rehydrate, but usable for any session (not only the
  /// selected one) so a background compaction loads the CompactionPart. Failure
  /// is non-fatal — the divider falls back to rendering on the next reselect.
  Future<void> rehydrateSessionMessages(String sessionId) async {
    try {
      final result = await _repository.getSession(sessionId);
      if (_disposed) return;
      _rehydrateChatMessages(sessionId, result.messages);
      notifyListeners();
    } catch (_) {
      // Non-fatal: the compaction divider still renders on a fresh reselect
      // (the CompactionPart is persisted in the session).
    }
  }

  // ── OCU-22 (#1063): VCS branch badge + dirty count ─────────────────────────

  /// `{branch, ...}` for [sessionId], or null when no fetch has completed yet
  /// OR the directory isn't a git repo (no `branch` key on the response). The
  /// badge should be hidden in both the "not fetched" and "non-git" cases.
  Map<String, dynamic>? vcsInfoFor(String sessionId) =>
      _vcsInfoBySession[sessionId];

  /// Changed-file entries (`{file, additions, deletions, status}`) from the
  /// last vcs/status fetch for [sessionId]. Empty when clean or not fetched.
  List<Map<String, dynamic>> vcsStatusFor(String sessionId) =>
      List.unmodifiable(_vcsStatusBySession[sessionId] ?? const []);

  bool vcsInfoLoading(String sessionId) => _vcsInfoLoading.contains(sessionId);

  /// Fetch (or refresh) the VCS branch + working-tree status for [sessionId].
  /// Non-fatal on error — a failed fetch just leaves the badge hidden/stale
  /// rather than surfacing a session-level error.
  Future<void> fetchVcsInfo(String sessionId) async {
    if (sessionId.isEmpty) return;
    if (_vcsInfoLoading.contains(sessionId)) return;
    _vcsInfoLoading.add(sessionId);
    try {
      final results = await Future.wait([
        _repository.getVcs(sessionId),
        _repository.getVcsStatus(sessionId),
      ]);
      if (_disposed) return;
      final info = results[0] as Map<String, dynamic>;
      // No `branch` key → not a git directory; store null so the badge hides.
      _vcsInfoBySession[sessionId] = info['branch'] != null ? info : null;
      _vcsStatusBySession[sessionId] =
          (results[1] as List<Map<String, dynamic>>);
    } catch (_) {
      // Leave any prior state as-is; the badge degrades to hidden/stale.
    } finally {
      _vcsInfoLoading.remove(sessionId);
      if (!_disposed) notifyListeners();
    }
  }

  /// Called when a `vcs.branch.updated` WS frame arrives. The frame is
  /// project-scoped (no sessionID), so we refresh the currently-selected
  /// session's badge — that's the only session visibly showing one.
  void handleVcsBranchUpdatedEvent() {
    final id = _selectedSessionId;
    if (id != null) unawaited(fetchVcsInfo(id));
  }

  /// Test-only: seed VCS info without a server round-trip.
  @visibleForTesting
  void setVcsInfoForTest(
    String sessionId, {
    Map<String, dynamic>? info,
    List<Map<String, dynamic>> status = const [],
  }) {
    _vcsInfoBySession[sessionId] = info;
    _vcsStatusBySession[sessionId] = status;
    notifyListeners();
  }

  // ── OCU-23 (#1064): Changes-tab scope toggle (vcs/diff) ────────────────────

  String _vcsDiffKey(String sessionId, String mode) => '$sessionId:$mode';

  /// VCS diff entries (`{file, patch, additions, deletions, status}`) for
  /// [sessionId] in [mode] ('git' = all uncommitted, 'branch' = vs default
  /// branch). Empty when not yet fetched or clean.
  List<Map<String, dynamic>> vcsDiffFor(String sessionId, String mode) =>
      List.unmodifiable(
        _vcsDiffByKey[_vcsDiffKey(sessionId, mode)] ?? const [],
      );

  bool vcsDiffLoading(String sessionId, String mode) =>
      _vcsDiffLoading.contains(_vcsDiffKey(sessionId, mode));

  String? vcsDiffErrorFor(String sessionId, String mode) =>
      _vcsDiffError[_vcsDiffKey(sessionId, mode)];

  /// Fetch (or refresh) the vcs/diff entries for [sessionId] in [mode].
  Future<void> fetchVcsDiff(String sessionId, String mode) async {
    final key = _vcsDiffKey(sessionId, mode);
    if (_vcsDiffLoading.contains(key)) return;
    _vcsDiffLoading.add(key);
    notifyListeners();
    try {
      final entries = await _repository.getVcsDiff(sessionId, mode);
      if (_disposed) return;
      _vcsDiffByKey[key] = entries;
      _vcsDiffError.remove(key);
    } catch (e) {
      if (_disposed) return;
      _vcsDiffByKey[key] ??= const [];
      _vcsDiffError[key] = e.toString();
    } finally {
      _vcsDiffLoading.remove(key);
      if (!_disposed) notifyListeners();
    }
  }

  /// Fetch the raw unified-diff patch text for [sessionId]'s uncommitted
  /// working-tree changes (used by the Changes-tab "Export patch" action).
  Future<String> fetchVcsDiffRaw(String sessionId) =>
      _repository.getVcsDiffRaw(sessionId);

  // ── OCU-24 (#1065): session.shell quick-run ─────────────────────────────────

  /// Run [command] as a non-interactive shell command inside [sessionId]. The
  /// engine executes it through the bash tool under the session's normal
  /// permission mode (plan/deny-all modes ask/deny like any other tool call),
  /// and the resulting message (with its bash tool part) arrives on the
  /// normal transcript WS stream — no separate rendering path is needed here.
  Future<void> runShellCommand(String sessionId, String command) async {
    try {
      await _repository.shellCommand(sessionId, command);
    } catch (e) {
      if (_disposed) return;
      _error = e.toString();
      notifyListeners();
    }
  }

  // ── OCU-25 (#1066): "Prepare project for agents" (session.init) ────────────

  bool isInitializingProject(String sessionId) =>
      _sessionInitializing[sessionId] ?? false;

  /// Run the engine's init flow (analyze the project + generate/update
  /// AGENTS.md) for [sessionId]. Progress streams through the normal
  /// transcript like any other turn; this only tracks a short-lived spinner
  /// for the header action while the POST is in-flight.
  Future<void> initializeProject(String sessionId) async {
    _sessionInitializing[sessionId] = true;
    notifyListeners();
    try {
      await _repository.initProject(sessionId);
    } catch (e) {
      if (_disposed) return;
      _error = e.toString();
    } finally {
      if (!_disposed) {
        _sessionInitializing.remove(sessionId);
        notifyListeners();
      }
    }
  }

  /// Test-only: seed the initializing state for [sessionId] without a server
  /// round-trip.
  @visibleForTesting
  void setInitializingForTest(String sessionId, bool initializing) {
    if (initializing) {
      _sessionInitializing[sessionId] = true;
    } else {
      _sessionInitializing.remove(sessionId);
    }
    notifyListeners();
  }

  // ── OCU-20 (#1061): @-mention fuzzy file attach ─────────────────────────────

  /// Fuzzy file search scoped to [sessionId]'s directory (worktree dir when
  /// isolated) for the composer @-mention popover. Not cached — each
  /// keystroke-debounced call proxies straight to the find-files endpoint.
  Future<List<String>> searchFiles(
    String sessionId,
    String query, {
    int limit = 20,
  }) =>
      _repository.findFiles(sessionId, query, limit: limit, type: 'file');

  /// Fetch a file's content through the worktree-safe content proxy (never
  /// local file IO — required so isolated-worktree sessions resolve correctly).
  /// Shape: `{type: 'text'|'binary', content, encoding?, mimeType?}`. Also used
  /// by the OCU-21 (#1062) Files-tab preview pane.
  Future<Map<String, dynamic>> fetchFileContent(
    String sessionId,
    String path,
  ) =>
      _repository.fileContent(sessionId, path);

  // ── OCU-21 (#1062): Inspector Files tab (browse + preview) ──────────────────

  /// List files/dirs at [path] ('.' = session root) within [sessionId]'s
  /// directory (worktree dir when isolated). Each entry:
  /// `{name, path, absolute, type: 'file'|'directory', ignored}`.
  Future<List<Map<String, dynamic>>> listSessionFiles(
    String sessionId, {
    String path = '.',
  }) =>
      _repository.listSessionFiles(sessionId, path: path);

  /// Git-aware file status for [sessionId]'s directory, used to render
  /// modified/untracked/staged status dots in the Files tab.
  Future<List<Map<String, dynamic>>> filesGitStatus(String sessionId) =>
      _repository.filesGitStatus(sessionId);

  // ── OPC-M3-2: revert / unrevert ────────────────────────────────────────────

  /// True when [sessionId] currently has an active revert (messages after the
  /// revert point are dimmed + badged; "Restore reverted changes" banner shown).
  bool sessionIsReverted(String sessionId) =>
      _sessionReverted[sessionId] ?? false;

  /// Alias of [sessionIsReverted] — true when [sessionId] has an active revert.
  bool isSessionReverted(String sessionId) => sessionIsReverted(sessionId);

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
  /// The spinner clears immediately when the POST returns successfully (204),
  /// ensuring the UI never hangs even if opencode doesn't emit a `compaction`
  /// WS part (e.g. in the embedded SDK). A WS `compaction` part may also
  /// clear it later — that's idempotent and fine.
  ///
  /// A 30-second safety timeout also clears the spinner as a backstop for
  /// any future hang scenario.
  ///
  /// Throws on server error — the view catches and surfaces it.
  Future<void> summarizeSession(String sessionId) async {
    _sessionCompacting[sessionId] = true;
    notifyListeners();

    // Safety timeout — clear compacting state after 30 seconds regardless of
    // WS events, so the spinner can never spin indefinitely.
    final timeoutTimer = Timer(const Duration(seconds: 30), () {
      if (!_disposed && (_sessionCompacting[sessionId] ?? false)) {
        _sessionCompacting.remove(sessionId);
        notifyListeners();
      }
    });

    try {
      await _repository.summarizeSession(sessionId);
      // Primary fix (OPC-#719): clear the spinner immediately on POST success.
      // The WS compaction part may arrive later and clear it again — idempotent.
      if (!_disposed) {
        timeoutTimer.cancel();
        _sessionCompacting.remove(sessionId);
        notifyListeners();
      }
    } catch (_) {
      // Clear compacting state on error so the UI doesn't stay stuck.
      timeoutTimer.cancel();
      if (!_disposed) {
        _sessionCompacting.remove(sessionId);
        notifyListeners();
      }
      rethrow;
    }
    // The WS compaction part handler (_onWsMessage, partType=='compaction')
    // also clears _sessionCompacting — that's fine; clearing twice is idempotent
    // and ensures the compaction divider renders once the part arrives.
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

  // ── Issue #862: "Memories used in this reply" ───────────────────────────

  /// The last-fetched memory provenance for [sessionId], or null when no
  /// fetch has occurred yet. Shape: `{ recorded, memoryIds, notePaths }`.
  /// `recorded: false` means no turn has ever been recorded for this session
  /// (distinct from a recorded turn with an empty `memoryIds`, which means
  /// that reply genuinely used no memories).
  Map<String, dynamic>? memoryProvenanceFor(String sessionId) =>
      _sessionMemoryProvenanceBySession[sessionId];

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

  // ── OPC-M3-6 / #861: child-session navigation (nested delegation) ──────────

  /// The SDK session id of the currently active child session (top of the
  /// navigation stack), or null when the user is viewing the top-level
  /// parent transcript.
  String? get activeChildSessionId =>
      _childStack.isEmpty ? null : _childStack.last.childSdkId;

  /// The local session id of the top-level parent whose task chip was
  /// originally tapped. Unlike [activeChildSessionId], this always reflects
  /// the FIRST hop's parent, not the immediate enclosing frame.
  String? get activeChildParentSessionId =>
      _childStack.isEmpty ? null : _childStack.first.fetchParentId;

  /// The display name of the session the breadcrumb navigates back to when
  /// [closeChildSession] is called — the immediate parent of the active
  /// (topmost) child, which for a nested hop is the enclosing child's own
  /// name, not the top-level session's.
  String? get activeChildParentName =>
      _childStack.isEmpty ? null : _childStack.last.parentDisplayName;

  /// The display name of the currently active (topmost) child session itself
  /// — the description of the task chip that was tapped to open it. Used as
  /// the breadcrumb target for a further-nested (grandchild+) chip tapped
  /// inside this child's own transcript.
  String? get activeChildDisplayName =>
      _childStack.isEmpty ? null : _childStack.last.displayName;

  /// How many hops deep the current child navigation is (0 = parent view,
  /// 1 = direct child, 2 = grandchild, …). Exposed for breadcrumb trails.
  int get childStackDepth => _childStack.length;

  /// Messages for the child session identified by [childSdkId].
  /// Returns an empty list when not yet fetched.
  List<AgentSessionMessage> childMessagesFor(String childSdkId) =>
      List.unmodifiable(_childMessagesByChildId[childSdkId] ?? const []);

  /// Open a child session transcript by fetching its messages from the server.
  ///
  /// Pushes a new frame onto the child-navigation stack so the UI swaps the
  /// main transcript area to this child's view. May be called again while a
  /// child is already active — this represents tapping a NESTED delegation
  /// (e.g. an orchestrator's own Task chip for a specialist), and pushes a
  /// second frame on top rather than replacing the first, so each hop's
  /// breadcrumb correctly returns to its own immediate parent.
  ///
  /// [parentSessionId] is the id used to fetch this child's messages — the
  /// top-level parent's LOCAL session id for the first hop, or the enclosing
  /// child's own SDK session id for a nested (grandchild+) hop.
  ///
  /// [childDisplayName] is this child's own display name (typically the
  /// tapped chip's description). Defaults to [parentSessionName] when omitted
  /// so existing single-hop callers keep working unchanged.
  ///
  /// Child messages are cached — subsequent opens of the same child are
  /// instant. Does NOT modify [_sessions] or [_resumable] — children never
  /// enter the sidebar lists.
  Future<void> openChildSession({
    required String parentSessionId,
    required String parentSessionName,
    required String childSdkId,
    String? childDisplayName,
  }) async {
    // #861 (maintainer smoke feedback): delegated subagent sessions are
    // usually ALREADY persisted as local sessions (#743, `parentId` +
    // `sdkSessionId`) and listed under the parent in the sidebar. A Task card
    // should simply LINK to that existing session — the normal, full session
    // view with its locally persisted transcript — not rebuild the child's
    // transcript through the engine child-fetch pipeline. Only when no local
    // row exists (engine-ephemeral child) fall back to the SDK fetch below.
    final localChild =
        _sessions.where((s) => s.sdkSessionId == childSdkId).firstOrNull;
    if (localChild != null) {
      _childStack.clear();
      await selectSession(localChild.id);
      return;
    }

    // Switch to the child view IMMEDIATELY so the click feels responsive — the
    // first fetch can be slow (cold opencode round-trip), and awaiting it before
    // switching made the chevron look frozen. Messages stream in afterward.
    _childStack.add(
      _ChildFrame(
        fetchParentId: parentSessionId,
        childSdkId: childSdkId,
        parentDisplayName: parentSessionName,
        displayName: childDisplayName ?? parentSessionName,
      ),
    );
    notifyListeners();

    // Cached → nothing to fetch; back-navigation stays instant.
    if (_childMessagesByChildId.containsKey(childSdkId)) {
      notifyListeners();
      return;
    }

    _loadingChildIds.add(childSdkId);
    notifyListeners();
    try {
      // #861 smoke fix: engine session reads are directory-scoped. For nested
      // hops parentSessionId is a raw SDK id with no local row, so the server
      // can't resolve the cwd itself — pass the selected root session's cwd.
      final rootCwd = _sessions
          .where((s) => s.id == _selectedSessionId)
          .map((s) => s.cwd)
          .firstOrNull;
      final messages = await _repository.fetchChildMessages(
        parentSessionId,
        childSdkId,
        cwd: rootCwd,
      );
      if (_disposed) return;
      _childMessagesByChildId[childSdkId] = messages;
    } catch (_) {
      if (_disposed) return;
      // Non-fatal: show empty child transcript rather than crashing.
      _childMessagesByChildId[childSdkId] = const [];
    } finally {
      _loadingChildIds.remove(childSdkId);
      if (!_disposed) notifyListeners();
    }
  }

  /// Navigate back ONE hop in the child-navigation stack.
  ///
  /// Pops the topmost frame WITHOUT refetching — cached message lists for
  /// every frame are preserved in-memory, so scroll context and messages
  /// remain intact when returning to an intermediate (e.g. orchestrator)
  /// level. When only one frame remains, this returns all the way to the
  /// top-level parent transcript, matching the pre-#861 behavior.
  void closeChildSession() {
    if (_childStack.isEmpty) return;
    _childStack.removeLast();
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

  /// Issue #862 — Fetch (or refresh) "Memories used in this reply" for
  /// [sessionId]. Non-fatal on error: a failed fetch leaves any prior entry
  /// in place rather than crashing the session view.
  Future<void> fetchMemoryProvenance(String sessionId) async {
    try {
      final provenance = await _repository.fetchMemoryProvenance(sessionId);
      if (_disposed) return;
      _sessionMemoryProvenanceBySession[sessionId] = provenance;
    } catch (_) {
      // Non-fatal: leave any prior entry as-is; absent entry reads as
      // "not fetched yet" via memoryProvenanceFor.
    } finally {
      if (!_disposed) notifyListeners();
    }
  }

  /// Test-only: seed the memory-provenance state for [sessionId] without a
  /// HTTP round-trip.
  @visibleForTesting
  void setMemoryProvenanceForTest(
    String sessionId,
    Map<String, dynamic> provenance,
  ) {
    _sessionMemoryProvenanceBySession[sessionId] = provenance;
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

  // ── OPC-M4-4: agent selection ───────────────────────────────────────────────

  /// Available agents for [sessionId]. Returns an empty list when no fetch has
  /// occurred yet (or when the SDK returned no agents).
  List<AgentInfo> availableAgentsFor(String sessionId) =>
      List.unmodifiable(_availableAgentsBySession[sessionId] ?? const []);

  bool hasOlderTranscript(String sessionId) =>
      _hasOlderTranscriptBySession[sessionId] ?? false;

  bool olderTranscriptLoading(String sessionId) =>
      _olderTranscriptLoading.contains(sessionId);

  /// [AgentSession.agentId] values that mean "no distinguishing agent" rather
  /// than a real dispatched identity: `''` is the wire value for a genuinely
  /// agent-less instant-create session (see agent_sessions_controller.ts),
  /// and `'claude-code'` is the generic base kind used as a client-side
  /// fallback (see [AgentSession.fromJson]) and as the server-side default
  /// for pre-#858/base-kind rows. Neither should override the app-wide
  /// picker's INITIAL default for a session that hasn't been dispatched to a
  /// specific profile.
  static const Set<String> _genericAgentIds = {'', 'claude-code'};

  /// Currently selected agent name for [sessionId].
  ///
  /// Resolution order (#867, supersedes the #745 order):
  ///   1. Explicit per-session selection stored in [_selectedAgentBySession]
  ///      (an EXPLICIT user action via [setSelectedAgent] — never a side
  ///      effect of sending or of the app-wide picker).
  ///   2. The session's OWN resolved engine agent — [AgentSession.agentId],
  ///      when the session already carries a non-generic one (see
  ///      [_genericAgentIds]). This is what makes a dispatched/subagent
  ///      session show and CONTINUE as its own agent instead of silently
  ///      inheriting the app-wide default.
  ///   3. Manager profile's ocAgent name (from [_managerAgentNameResolver])
  ///      — the INITIAL default for a brand-new top-level session that has
  ///      no agent of its own yet.
  ///   4. null → SDK default ('build') when no manager profile is configured.
  ///
  /// Does NOT change permissionMode — the PermissionModePicker is the sole
  /// owner of that field (c6 regression contract).
  String? selectedAgentFor(String sessionId) {
    if (_selectedAgentBySession.containsKey(sessionId)) {
      return _selectedAgentBySession[sessionId];
    }
    final sessionAgentId = _sessionById(sessionId)?.agentId;
    if (sessionAgentId != null && !_genericAgentIds.contains(sessionAgentId)) {
      return sessionAgentId;
    }
    // #890: a brand-new session shows the profile it WILL be created as — the
    // user-configured "Default profile" override first, matching
    // _resolveDefaultAgentIdForCreate so the picker and the spawned agent
    // agree. Falls back to the manager-name resolver (wired to the Secretary
    // profile in main.dart), then null.
    final override = _configuredDefaultAgentResolver?.call();
    if (override != null && override.isNotEmpty) return override;
    return _managerAgentNameResolver?.call();
  }

  /// Returns true when the user has made an explicit per-session agent
  /// selection (distinct from both the session's own resolved agent and the
  /// manager-profile default). Used by [AgentSelectorPill] to colour the pill
  /// as "overridden" (#745) — a session merely displaying/using its own
  /// dispatched agent identity is NOT an override (#867).
  bool hasExplicitAgentSelection(String sessionId) =>
      _selectedAgentBySession.containsKey(sessionId) &&
      _selectedAgentBySession[sessionId] != null;

  /// Set the per-turn agent for [sessionId].
  ///
  /// Passing null removes the explicit per-session entry so that
  /// [selectedAgentFor] falls back to the manager profile resolver (#745).
  /// This is the "reset to default" path — the picker sends null when the
  /// user selects the placeholder "build (default)" item.
  ///
  /// Does NOT touch permissionMode or any other session field — the agent
  /// selector is orthogonal to the PermissionModePicker (c6).
  void setSelectedAgent(String sessionId, String? agentName) {
    if (agentName == null) {
      _selectedAgentBySession.remove(sessionId);
    } else {
      _selectedAgentBySession[sessionId] = agentName;
      // #1119 — an explicit profile pick must survive an app restart. Prior
      // to this fix, `agentName` only ever went out per-turn on the WS
      // `session.input` frame (sendInput, "never persisted" by OPC-M4-4
      // design) and was never written to the session row, so `agentId`
      // resolution order step 2 (this session's OWN stored agent, see
      // selectedAgentFor doc) always fell back to the row's original value
      // after a restart wiped this in-memory map. Fire-and-forget: a failed
      // persist only costs cross-restart continuity, not this run's behavior.
      unawaited(_persistSelectedAgent(sessionId, agentName));
    }
    notifyListeners();
  }

  /// Writes the explicitly-selected profile onto the session row so restart
  /// rehydration (selectedAgentFor step 2) picks it up. Non-fatal on failure.
  Future<void> _persistSelectedAgent(String sessionId, String agentName) async {
    try {
      final updated = await _repository.updateSession(
        sessionId,
        agentId: agentName,
      );
      if (_disposed) return;
      _sessions = [for (final s in _sessions) s.id == sessionId ? updated : s];
      notifyListeners();
    } catch (_) {
      // Non-fatal — the in-memory selection still drives this session for
      // the rest of the current run.
    }
  }

  /// Fetch available agents for [sessionId] from the server.
  ///
  /// Called on selectSession. Non-fatal: the selector falls back to an empty
  /// list (the server returns [] when the engine isn't ready, which the Flutter
  /// selector treats as "show built-ins only" with a hard-coded build/plan pair).
  Future<void> fetchAvailableAgents(String sessionId) async {
    try {
      final cwd = (_sessions.firstWhereOrNull((s) => s.id == sessionId) ??
              _resumable.firstWhereOrNull((s) => s.id == sessionId))
          ?.cwd;
      final agents = await _repository.fetchAvailableAgents(cwd: cwd);
      if (_disposed) return;
      _availableAgentsBySession[sessionId] = agents;
      if (!_disposed) notifyListeners();
    } catch (_) {
      // Non-fatal — keep stale (or empty) list; selector degrades gracefully.
    }
  }

  /// Fetch and merge the next older transcript page for [sessionId].
  ///
  /// Existing REST and WebSocket rows remain authoritative by stable message
  /// id. Rehydration de-duplicates them, then chronological sorting restores
  /// display order after the older page is merged.
  Future<void> loadOlderTranscript(String sessionId) async {
    if (_olderTranscriptLoading.contains(sessionId) ||
        !hasOlderTranscript(sessionId)) {
      return;
    }
    _olderTranscriptLoading.add(sessionId);
    notifyListeners();
    try {
      final page = await _repository.fetchTranscriptPage(
        sessionId,
        limit: _transcriptPageSize,
        before: _olderTranscriptCursorBySession[sessionId],
      );
      if (_disposed) return;
      _rehydrateChatMessages(sessionId, page.messages);
      _olderTranscriptCursorBySession[sessionId] = page.nextCursor;
      _hasOlderTranscriptBySession[sessionId] = page.hasMore;
    } catch (_) {
      // Non-fatal: keep the current window and leave the affordance available
      // so the user can retry.
    } finally {
      _olderTranscriptLoading.remove(sessionId);
      if (!_disposed) notifyListeners();
    }
  }

  /// Test-only: seed the available agents for [sessionId] without a network
  /// round-trip. Used by flutter tests to simulate the server response.
  @visibleForTesting
  void setAvailableAgentsForTest(String sessionId, List<AgentInfo> agents) {
    _availableAgentsBySession[sessionId] = List.of(agents);
    notifyListeners();
  }

  // --------------------------------------------------------------------------
  // PTY
  // --------------------------------------------------------------------------

  /// POST /agent-sessions/:id/pty — create a new PTY for the session.
  ///
  /// Returns the ptyId assigned by the server. Throws on HTTP error.
  Future<String> createPty(String sessionId) =>
      _repository.createPty(sessionId);

  /// PATCH /pty/:id — resize the PTY to [cols] × [rows].
  ///
  /// Throws on HTTP error.
  Future<void> resizePty(String ptyId, int cols, int rows) =>
      _repository.resizePty(ptyId, cols, rows);

  /// DELETE /pty/:id — kill the PTY process.
  ///
  /// Throws on HTTP error.
  Future<void> killPty(String ptyId) => _repository.killPty(ptyId);

  /// Returns the WebSocket URL for the PTY with [ptyId].
  String ptyWsUrl(String ptyId) => _repository.ptyWsUrl(ptyId);

  // ── Session-scoped terminals ──────────────────────────────────────────────
  //
  // Smoke-fix: the interactive Terminal tab's PTY lifetime is tied to the
  // SESSION, not to the TerminalTab widget. Collapsing the side panel or
  // switching the panel's Context/Changes/Terminal tabs disposes the widget;
  // previously that killed the PTY and lost the live shell. Now the terminal
  // state lives here (keyed by session id) and survives widget remounts. The
  // PTY is torn down only when the session is closed/deleted (see
  // [_disposeTerminal]) or the controller is disposed.
  final Map<String, PtyTerminalSession> _terminals = {};

  /// Test seam: overrides the transport channel factory used when a new
  /// [PtyTerminalSession] is created. Set before the Terminal tab first opens.
  PtyChannelFactory? _ptyChannelFactoryForTest;

  @visibleForTesting
  set ptyChannelFactoryForTest(PtyChannelFactory? factory) =>
      _ptyChannelFactoryForTest = factory;

  /// Get-or-create the [PtyTerminalSession] for [sessionId]. Creating one
  /// starts the PTY exactly once (lazily, on first Terminal-tab open). The same
  /// instance — and therefore the same shell + scrollback buffer — is reused
  /// across [TerminalTab] remounts (panel collapse, tab switch).
  PtyTerminalSession terminalSessionFor(String sessionId) {
    return _terminals.putIfAbsent(sessionId, () {
      final session = PtyTerminalSession(
        sessionId: sessionId,
        createPty: createPty,
        resizePty: resizePty,
        killPty: killPty,
        ptyWsUrl: ptyWsUrl,
        channelFactory: _ptyChannelFactoryForTest,
      );
      unawaited(session.start());
      return session;
    });
  }

  /// Tear down and forget the terminal for [sessionId] (kills its PTY exactly
  /// once). Called from every session close/delete path. No-op when the session
  /// has no terminal.
  void _disposeTerminal(String sessionId) {
    _terminals.remove(sessionId)?.dispose();
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
  // Inspector panel collapse (persisted)
  // --------------------------------------------------------------------------

  /// Whether the inspector panel is collapsed. Persisted across app launches
  /// via shared_preferences key [_inspectorCollapsedKey].
  bool get panelCollapsed => _panelCollapsed;

  /// Current width (px) of the inspector panel. Persisted across app launches
  /// via shared_preferences key [_inspectorWidthKey]. Always within
  /// [[_kMinPanelWidth], [_kMaxPanelWidth]].
  double get panelWidth => _panelWidth;

  /// Load the persisted inspector panel prefs (collapse flag + width) from
  /// shared_preferences. Called from [initialize] so prefs are restored on
  /// startup. Persistence failures are non-fatal (defaults retained).
  Future<void> loadInspectorPrefs() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      // #905 — default to collapsed (true) when no preference has been
      // stored yet; a user who has explicitly opened it before keeps that.
      _panelCollapsed = prefs.getBool(_inspectorCollapsedKey) ?? true;
      final storedWidth = prefs.getDouble(_inspectorWidthKey);
      if (storedWidth != null) {
        _panelWidth =
            storedWidth.clamp(_kMinPanelWidth, _kMaxPanelWidth).toDouble();
      }
      notifyListeners();
    } catch (_) {
      _panelCollapsed = true;
      _panelWidth = _kDefaultPanelWidth;
    }
  }

  /// Set and persist the inspector panel width, clamped to
  /// [[_kMinPanelWidth], [_kMaxPanelWidth]]. No-op when the clamped value
  /// matches the current width. Persistence failures are non-fatal.
  Future<void> setPanelWidth(double width) async {
    final clamped = width.clamp(_kMinPanelWidth, _kMaxPanelWidth).toDouble();
    if (_panelWidth == clamped) return;
    _panelWidth = clamped;
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setDouble(_inspectorWidthKey, clamped);
    } catch (_) {}
  }

  /// Set and persist the inspector panel collapse flag.
  /// No-op when [collapsed] matches the current value.
  Future<void> setPanelCollapsed(bool collapsed) async {
    if (_panelCollapsed == collapsed) return;
    _panelCollapsed = collapsed;
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_inspectorCollapsedKey, collapsed);
    } catch (_) {}
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
    unawaited(loadInspectorPrefs());
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
    // Warm the account-label cache (best-effort) so the session header badge
    // and spillover toast can resolve labels synchronously.
    unawaited(AnthropicAccountsLabelCache.ensureLoaded());
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

  /// Issue #718 — Returns the context-window size (tokens) for the given
  /// session's selected model, looked up from the catalog.
  ///
  /// Returns null when the catalog hasn't been loaded yet, the session has no
  /// selected model, or the catalog entry for the model has no [contextLimit].
  /// Callers should fall back to a default (e.g. 200k) when null is returned.
  int? contextWindowForSession(AgentSession session) {
    final providerId = session.providerId;
    final modelId = session.modelId;
    if (providerId == null || modelId == null) return null;
    for (final e in _catalog) {
      if (e.provider == providerId &&
          e.modelId == modelId &&
          e.contextLimit != null) {
        return e.contextLimit;
      }
    }
    return null;
  }

  /// Human-readable model name for [session], looked up from the catalog by
  /// matching provider + model id. Falls back to '`providerId`/`modelId`'
  /// (with '?' for missing parts) when the catalog has no matching entry.
  String modelDisplayName(AgentSession session) {
    final providerId = session.providerId;
    final modelId = session.modelId;
    for (final e in _catalog) {
      if (e.provider == providerId && e.modelId == modelId) {
        return e.displayName;
      }
    }
    return '${providerId ?? '?'}/${modelId ?? '?'}';
  }

  /// Injects a catalog for testing without going through [refreshCatalog].
  @visibleForTesting
  void setCatalogForTest(List<CatalogModelEntry> entries) {
    _catalog = List.of(entries);
    _catalogLoaded = true;
  }

  /// #1025 (USO A2) — switch the active category scope and reload the list.
  /// Passing the current scope again acts as a plain refresh.
  Future<void> loadSessions(AgentSessionScope scope) async {
    _scope = scope;
    await load();
  }

  Future<void> load() async {
    _status = AgentsLoadStatus.loading;
    notifyListeners();
    try {
      final result = await _repository.listSessions(scope: _scope.wireValue);
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
    // OPC-#710: name defaults to '' for instant-create sessions. Opencode
    // auto-titles via session.updated after the first exchange.
    String name = '',
    String? branch,
    String? stash,
    bool createBranch = false,
    String? mcpRole,
    String? anthropicAccountId,
    // OCU-18 (#1059): run this session in an isolated git worktree.
    bool isolateWorktree = false,
    String? worktreeName,
  }) async {
    _error = null;
    _lastErrorStatus = null;
    // Issue #653: if the caller passed null, try to default to the first
    // authorized agent from the loaded catalog. If the catalog isn't loaded
    // yet OR has no authorized entries, pass null through to the repository
    // — the server will respond with 400 ('agent not configured') and we
    // surface that to the user verbatim (consistent with existing 4xx UX).
    final resolvedAgentId = agentId ?? _resolveDefaultAgentIdForCreate() ?? '';
    // OPC-#713: signal that a create is in-flight so the view can show an
    // optimistic loading indicator while the SDK session spins up.
    _creating = true;
    notifyListeners();
    try {
      final session = await _repository.createSession(
        agentId: resolvedAgentId.isEmpty ? agentId : resolvedAgentId,
        taskId: taskId,
        cwd: cwd,
        name: name,
        branch: branch,
        stash: stash,
        createBranch: createBranch,
        mcpRole: mcpRole,
        anthropicAccountId: anthropicAccountId,
        isolateWorktree: isolateWorktree,
        worktreeName: worktreeName,
      );
      _sessions = [..._sessions, session];
      sessionFirstSeenAt[session.id] = DateTime.now();
      _creating = false;
      notifyListeners();
      return session;
    } catch (e) {
      _creating = false;
      if (e is AppError) {
        _error = _friendlyCreateSessionError(e);
        _lastErrorStatus = e.statusCode;
      } else {
        _error = e.toString();
      }
      notifyListeners();
      return null;
    }
  }

  /// #1154 — Defense-in-depth: a session-create 400 body is a server-side
  /// validation string (e.g. `Unknown mcpRole: "secretary"`), not user-facing
  /// copy. The real fix is making mcpRole resolution work in the bundled app
  /// (see `MCP_ROLES_DIR` wiring in `ApiServerService`); this guard just
  /// ensures that raw string never reaches the footer if resolution ever
  /// fails again (unknown role, corrupt role file, etc).
  static String _friendlyCreateSessionError(AppError e) {
    if (e.message.contains('mcpRole')) {
      return "Couldn't start this assistant. Please try again.";
    }
    return e.message;
  }

  /// Picks the default agent for `createSession` callers that haven't chosen
  /// one. Returns null when the catalog hasn't loaded yet or has no authorized
  /// entries — caller surfaces an error in that case.
  ///
  /// #890: resolution order is
  ///   1. The app-level "Default profile" override from
  ///      [_configuredDefaultAgentResolver], IF it matches an `authorized`
  ///      catalog entry with a non-empty agent slug. An override pointing at
  ///      a since-removed/unauthorized profile is ignored (falls through).
  ///   2. Secretary (#889) — the seeded default hub; delegates domain work to
  ///      specialists and coding to the workflow-orchestrator.
  ///   3. The first authorized catalog entry (#653).
  String? _resolveDefaultAgentIdForCreate() {
    // The default agent is an agent PROFILE (ocAgent, e.g. 'secretary'), which
    // the server resolves — NOT a `_catalog` entry. `_catalog` lists only
    // engine kinds (claude-code/codex/gemini-cli/opencode), so gating the
    // profile default on catalog membership never matched and silently fell
    // through to an engine kind (the #889/#890 bug). Return the profile
    // directly instead.
    // #890: the user-configured "Default profile" override wins.
    final override = _configuredDefaultAgentResolver?.call();
    if (override != null && override.isNotEmpty) return override;
    // #889: Secretary is the seeded product-default hub (always seeded), which
    // then delegates domain work to specialists and coding to the
    // workflow-orchestrator.
    return _secretaryAgentSlug;
  }

  /// Stable engine-agent slug for the Secretary manager profile (#888/#889).
  static const String _secretaryAgentSlug = 'secretary';

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
      _disposeTerminal(id);
    }
    notifyListeners();

    if (!_agentServerController.isReady) return;
    final failed = <String>[];
    await Future.wait(
      idSet.map((id) async {
        try {
          await _repository.deleteSession(id);
        } catch (_) {
          failed.add(id);
        }
      }),
    );
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
    _disposeTerminal(id);
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
      _sessions = [for (final s in _sessions) s.id == id ? updated : s];
      notifyListeners();
    } catch (e) {
      _error = e is AppError ? e.message : e.toString();
      notifyListeners();
    }
  }

  /// M2-4: cancel an in-flight turn. On success, optimistically clear the
  /// working flag so the Stop button visibly takes effect immediately (the
  /// bridge also relays session.idle when opencode aborts).
  Future<void> cancelSession(String id) async {
    try {
      await _repository.cancelSession(id);
      _working[id] = false;
      notifyListeners();
    } catch (e) {
      _error = e is AppError ? e.message : e.toString();
      notifyListeners();
    }
  }

  // --------------------------------------------------------------------------
  // Permission flow (#608)
  // --------------------------------------------------------------------------

  /// Accept a pending permission — POST to the server and remove from local state.
  Future<void> acceptPermission(String sessionId, String permissionId) async {
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
  ///
  /// OCU-02 (#1043): [reason] is an optional message shown to the agent
  /// explaining why the action was denied.
  Future<void> denyPermission(
    String sessionId,
    String permissionId, {
    String? reason,
  }) async {
    _removePendingPermission(sessionId, permissionId);
    notifyListeners();
    try {
      await _repository.respondPermission(
        sessionId,
        permissionId,
        'deny',
        message: reason,
      );
    } catch (e) {
      _error = e is AppError ? e.message : e.toString();
      notifyListeners();
    }
  }

  /// OCU-02 (#1043): approve a pending permission for the remainder of the
  /// project (server maps 'always' to the engine's `always` reply so the
  /// same action is not re-asked).
  Future<void> alwaysAllowPermission(
    String sessionId,
    String permissionId,
  ) async {
    _removePendingPermission(sessionId, permissionId);
    notifyListeners();
    try {
      await _repository.respondPermission(sessionId, permissionId, 'always');
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
  // Question (AskUserQuestion) handshake
  // --------------------------------------------------------------------------

  /// Authoritative questions for a tool [callId] from the `question.asked`
  /// frame, or null if none were broadcast (card falls back to the tool input).
  List<dynamic>? questionsForCallId(String sessionId, String callId) =>
      _questionsByCallId['$sessionId:$callId'];

  /// True once the question for [callId] has been answered or dismissed.
  bool isQuestionResolved(String sessionId, String callId) =>
      _resolvedQuestionCallIds.contains('$sessionId:$callId');

  /// Answer a pending `question` (AskUserQuestion) tool call. [answers] is one
  /// `List<String>` per question (the selected option labels). This is the path
  /// that actually unblocks the agent — a plain `session.input` does NOT.
  Future<void> replyQuestion(
    String sessionId,
    String callId,
    List<List<String>> answers,
  ) async {
    _resolvedQuestionCallIds.add('$sessionId:$callId');
    _questionsByCallId.remove('$sessionId:$callId');
    notifyListeners();
    try {
      await _repository.replyQuestion(sessionId, callId, answers);
    } catch (e) {
      _error = e is AppError ? e.message : e.toString();
      notifyListeners();
    }
  }

  /// Dismiss a pending question without answering (the user declines). This
  /// also unblocks the agent so the session never hangs.
  Future<void> rejectQuestion(String sessionId, String callId) async {
    _resolvedQuestionCallIds.add('$sessionId:$callId');
    _questionsByCallId.remove('$sessionId:$callId');
    notifyListeners();
    try {
      await _repository.rejectQuestion(sessionId, callId);
    } catch (e) {
      _error = e is AppError ? e.message : e.toString();
      notifyListeners();
    }
  }

  // --------------------------------------------------------------------------
  // Permission mode (#611)
  // --------------------------------------------------------------------------

  /// PATCH the session's permissionMode. Optimistically updates the local row.
  Future<void> setPermissionMode(String sessionId, PermissionMode mode) async {
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
      _sessions = [for (final s in _sessions) s.id == sessionId ? updated : s];
      notifyListeners();
    } catch (e) {
      _error = e is AppError ? e.message : e.toString();
      notifyListeners();
    }
  }

  /// Dual-account follow-up: switch the Claude account an existing session is
  /// routed to (header badge menu). Optimistic local update; the server also
  /// echoes the change via the session.updated WS broadcast.
  Future<void> setSessionAnthropicAccount(
    String sessionId,
    String accountId,
  ) async {
    _sessions = [
      for (final s in _sessions)
        if (s.id == sessionId) s.copyWith(anthropicAccountId: accountId) else s,
    ];
    notifyListeners();
    try {
      final updated = await _repository.updateSession(
        sessionId,
        anthropicAccountId: accountId,
      );
      _sessions = [for (final s in _sessions) s.id == sessionId ? updated : s];
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
      _disposeTerminal(id);
      notifyListeners();
      return;
    }
    try {
      await _repository.closeSession(id);
      // Belt-and-suspenders: dispose the PTY directly here so a dropped WS
      // echo (SessionClosedMessage) cannot leave the PTY alive until app exit.
      // _disposeTerminal is idempotent — the later WS echo's call is a no-op.
      _disposeTerminal(id);
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
    _disposeTerminal(id);
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

  // --------------------------------------------------------------------------
  // OCU-18 (#1059): Changes-tab isolated-worktree actions
  // --------------------------------------------------------------------------

  bool _worktreeActionInFlight = false;

  /// True while a reset/remove worktree call is in flight — used to disable
  /// the Changes-tab actions and avoid a duplicate submit.
  bool get worktreeActionInFlight => _worktreeActionInFlight;

  /// Reset the session's isolated worktree branch back to the primary
  /// default branch. Returns true on success.
  Future<bool> resetWorktree(String sessionId) async {
    _worktreeActionInFlight = true;
    notifyListeners();
    try {
      await _repository.resetWorktree(sessionId);
      return true;
    } catch (e) {
      _error = e is AppError ? e.message : e.toString();
      return false;
    } finally {
      _worktreeActionInFlight = false;
      notifyListeners();
    }
  }

  /// Remove the session's isolated git worktree. On success, updates the
  /// local session row so the worktree badge disappears immediately.
  Future<bool> removeWorktree(String sessionId) async {
    _worktreeActionInFlight = true;
    notifyListeners();
    try {
      final updated = await _repository.removeWorktree(sessionId);
      _sessions = _upsertById(_sessions, updated);
      return true;
    } catch (e) {
      _error = e is AppError ? e.message : e.toString();
      return false;
    } finally {
      _worktreeActionInFlight = false;
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
      _pendingAttachmentsBySession[sessionId] ?? [],
    );
    final allAttachments = [...?attachments, ...controllerPending];
    final useParts = allAttachments.isNotEmpty;
    // OPC-M4-4 / #745: include the per-session selected agent.
    // selectedAgentFor resolves: explicit selection → manager default → null.
    final selectedAgent = selectedAgentFor(sessionId);
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
      // OPC-M4-4: forward agent name when set; absent → SDK default (build).
      if (selectedAgent != null) 'agent': selectedAgent,
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
    // OCU-05 (#1046): if the session was already working, the engine queues this
    // input behind the active turn — flag the bubble so it renders a "queued"
    // chip until message.updated reconciles it.
    if (isWorking(sessionId)) {
      _queuedMessageIds.add(optimisticMsgId);
    }
    final optimisticMsg = ChatMessage(
      id: optimisticMsgId,
      sessionId: sessionId,
      role: 'user',
      createdAt: DateTime.now().toUtc(),
    );
    (_chatMessagesBySession[sessionId] ??= []).add(optimisticMsg);
    // Build the parts list for the optimistic insert: text first, then any
    // file parts so the user bubble renders thumbnails/chips immediately.
    //
    // Issue #717: text-type attachments (inlined file content) are rendered
    // as a filename chip (type='file' with no url) rather than as prose so
    // the user can see which file was attached. The actual text content is
    // forwarded to the server in the parts array and the model sees it.
    final optimisticParts = <ChatPart>[
      ChatPart(
        id: '${optimisticMsgId}_text',
        messageId: optimisticMsgId,
        type: 'text',
        text: data,
      ),
      // OPC-M4-1 / #717: add one chip per attachment.
      // For text-type attachments (file content inlined), render a filename
      // chip with no url (the model reads the text; the bubble shows the name).
      for (var i = 0; i < allAttachments.length; i++)
        ChatPart(
          id: '${optimisticMsgId}_file_$i',
          messageId: optimisticMsgId,
          type: 'file',
          fileMime: allAttachments[i]['mime'] as String?,
          fileFilename: allAttachments[i]['filename'] as String?,
          fileUrl: allAttachments[i]['type'] == 'text'
              ? null // text attachment — no data URI; filename chip only
              : allAttachments[i]['url'] as String?,
        ),
    ];
    _chatPartsByMessage[optimisticMsgId] = optimisticParts;

    // OPC-#712 — client-side auto-title fallback.
    //
    // When the session has no meaningful name (empty or the 'New session'
    // placeholder shown in the sidebar), derive one from the first user
    // message text immediately so the list updates without waiting for
    // opencode's server-side session.updated event (which may never arrive
    // for sessions created through Rhythm's prompt path).
    //
    // The fallback is set only on the FIRST user turn (i.e. the optimistic
    // insert is the only message in the chat store for this session) so we
    // don't re-title sessions mid-conversation.
    //
    // When session.updated later carries a non-empty title from the server,
    // the SessionUpdatedMessage handler (_onWsMessage) replaces the whole
    // session row via _upsertById — the server title wins automatically
    // without any extra logic here.
    final sessionMessages = _chatMessagesBySession[sessionId];
    final isFirstUserTurn =
        sessionMessages != null && sessionMessages.length == 1;
    if (isFirstUserTurn) {
      final session = _sessions.firstWhereOrNull((s) => s.id == sessionId);
      if (session != null) {
        final currentName = session.name.trim();
        final needsFallback =
            currentName.isEmpty || currentName == 'New session';
        if (needsFallback) {
          final rawText = data.trim();
          final fallbackTitle =
              rawText.length > 40 ? '${rawText.substring(0, 40)}…' : rawText;
          if (fallbackTitle.isNotEmpty) {
            _sessions = [
              for (final s in _sessions)
                if (s.id == sessionId) s.copyWith(name: fallbackTitle) else s,
            ];
          }
        }
      }
    }

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
      createdAt: DateTime.now().toUtc(),
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

  /// Convenience wrapper used by UnifiedAgentModelPicker — stages a per-turn
  /// override using the picker's row type. Pass null to clear.
  void setTurnOverride(AgentModelRoute? route) {
    _pendingTurnOverride = route;
    notifyListeners();
  }

  /// Convenience wrapper used by UnifiedAgentModelPicker — persists the route as
  /// the session-level default via [updateSession].
  ///
  /// Also sets the pending turn override so the very next [send] still ships
  /// a `modelOverride` in the WS message. Without this, the session row in
  /// the DB has the model persisted but the server-side resolver for
  /// `agentKind === '__pending__'` rejects the input ("Pick a model before
  /// sending the first message.") because the per-turn override is empty —
  /// the persisted default is read from the DB but it hasn't been written
  /// yet from the server's perspective when `session.input` arrives.
  Future<void> setSessionModel(String sessionId, AgentModelRoute route) async {
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
      _sessions = [for (final s in _sessions) s.id == sessionId ? updated : s];
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
      _sessions = [for (final s in _sessions) s.id == sessionId ? updated : s];
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
    await _refreshSessionDetail(id, subscribe: true);
    // Load model routes for the newly selected session in the background.
    _loadModelRoutes(id);
    // Load slash commands for this session (Issue #610).
    _loadSlashCommands(id);
    // OPC-M3-5: fetch the todo list for this session on first select.
    unawaited(fetchSessionTodos(id));
    // Issue #862: fetch "Memories used in this reply" for this session.
    unawaited(fetchMemoryProvenance(id));
    // OPC-M4-4: fetch available agents for the session cwd.
    unawaited(fetchAvailableAgents(id));
    // OCU-22 (#1063): fetch the branch badge + dirty count for this session.
    unawaited(fetchVcsInfo(id));
    // OPC-#715: refresh the catalog on every session select so that curation
    // changes made since the last WS-connect fetch (e.g. a newly-curated
    // OpenRouter model) are reflected in the new session's model picker without
    // requiring the user to re-toggle the model in the curator.
    unawaited(refreshCatalog());
  }

  /// Refresh the open session row and transcript without changing selection.
  /// Used by the mounted detail view while observing a headless run, which
  /// persists progress without emitting the WS events used by interactive turns.
  Future<void> refreshSelectedSessionDetail(String id) =>
      _refreshSessionDetail(id, subscribe: false);

  Future<void> _refreshSessionDetail(
    String id, {
    required bool subscribe,
  }) async {
    try {
      final result = await _repository.getSession(id);
      if (_disposed || _selectedSessionId != id) return;
      _sessions = _upsertById(_sessions, result.session);
      _rehydrateChatMessages(id, result.messages);
      if (!_olderTranscriptCursorBySession.containsKey(id)) {
        _olderTranscriptCursorBySession[id] = result.messages.isEmpty
            ? null
            : result.messages.first.id.toString();
        _hasOlderTranscriptBySession[id] =
            result.messages.length >= _transcriptPageSize;
      }
      notifyListeners();
      if (subscribe) {
        _repository.send({'type': 'session.subscribe', 'id': id});
      }
    } catch (e) {
      if (_disposed || _selectedSessionId != id) return;
      _error = e.toString();
      notifyListeners();
    }
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

  /// OCU-11 (#1052): force a re-fetch of the slash-command catalog for
  /// [sessionId], bypassing the [_loadSlashCommands] cache guard. Called when
  /// the slash popover opens so a playbook created/edited/deleted in the
  /// Playbooks manager (or another window) shows up without an app restart.
  Future<void> refreshSlashCommands(String sessionId) async {
    _commandsBySession.remove(sessionId);
    await _loadSlashCommands(sessionId);
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
          seq: row.id,
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
          // Backfill the ordering key for a message first seen over WS. Without
          // this it keeps seq == null forever and always sorts to the tail, which
          // scrambles the transcript as soon as an older page is loaded.
          existing.seq ??= row.id;
          if (existing.cost == null && row.cost != null) {
            existing.cost = row.cost;
          }
          if (existing.tokens == null && row.tokens != null) {
            existing.tokens = row.tokens;
          }
        }
      }

      // Adopt whichever copy of the parts is MORE COMPLETE.
      //
      // This used to be `if (existingParts == null || existingParts.isEmpty)` —
      // i.e. REST was ignored whenever ANY local part existed, to avoid clobbering
      // a live stream. That protected in-flight streams and permanently stranded
      // interrupted ones identically: navigate away from an ACTIVE session
      // mid-stream and the partial delta left behind blocked the authoritative
      // REST content forever, so the message rendered truncated or blank on every
      // subsequent visit. Reported live 2026-08-05, and it survived the ordering
      // fix in 585abf89 because it is a different defect — content, not order.
      //
      // Comparing completeness is safe in both directions: REST wins for a stream
      // that was cut off (it holds the finished text), local wins while a stream
      // is genuinely mid-flight and ahead of what the DB has persisted.
      final existingParts = _chatPartsByMessage[msgId];
      final restParts =
          row.parts?.map((p) => ChatPart.fromJson(msgId, p)).toList();
      final restIsMoreComplete = restParts != null &&
          restParts.isNotEmpty &&
          partsWeight(restParts) >= partsWeight(existingParts);
      if (restIsMoreComplete) {
        _chatPartsByMessage[msgId] = restParts;
      } else if (existingParts == null || existingParts.isEmpty) {
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
    (_chatMessagesBySession[sessionId] ??= []).sort(compareChatMessages);
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
      // #1090 — the WS channel is shared across all scopes; only insert the
      // session if it belongs to the scope currently being viewed (mirrors
      // the server's `?scope=` filter, which a full [load] already relies on).
      if (_belongsToScope(msg.session, _scope) &&
          !_sessions.any((s) => s.id == msg.session.id)) {
        _sessions = [..._sessions, msg.session];
      }
      // Record first-seen via WS (??= so createSession() timestamp takes
      // precedence if the REST call already recorded it).
      sessionFirstSeenAt[msg.session.id] ??= DateTime.now();
    } else if (msg is SessionClosedMessage) {
      final closed = _sessions.firstWhereOrNull((s) => s.id == msg.id);
      _sessions = _sessions.where((s) => s.id != msg.id).toList();
      sessionFirstSeenAt.remove(msg.id);
      _disposeTerminal(msg.id);
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
      // #761 — ensure the assistant bubble exists before attaching the part.
      _ensureLiveAssistantMessage(msg.sessionId, msg.messageId);
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
      // #761 — ensure the assistant bubble exists before appending the delta.
      _ensureLiveAssistantMessage(msg.sessionId, msg.messageId);
      _appendChatDelta(
        messageId: msg.messageId,
        partId: msg.partId,
        field: msg.field,
        delta: msg.delta,
      );
    } else if (msg is MessageRemovedMessage) {
      _removeChatMessage(sessionId: msg.sessionId, messageId: msg.messageId);
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
        createdAt: DateTime.now().toUtc(),
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
        // #1090 — same scope guard as SessionCreatedMessage above: don't let
        // a background/scheduled/self_improvement session upsert into the
        // scope list currently being viewed.
        if (_belongsToScope(s, _scope)) {
          _sessions = _upsertById(_sessions, s);
        }
      }
    } else if (msg is SessionRemovedMessage) {
      // #605 — hard-deleted row; drop from all local caches.
      _sessions = _sessions.where((x) => x.id != msg.id).toList();
      _resumable = _resumable.where((x) => x.id != msg.id).toList();
      _archived = _archived.where((x) => x.id != msg.id).toList();
      _chatMessagesBySession.remove(msg.id);
      _lastPartActivityAt.remove(msg.id);
      sessionFirstSeenAt.remove(msg.id);
      _disposeTerminal(msg.id);
      if (_selectedSessionId == msg.id) _selectedSessionId = null;
    } else if (msg is AgentConfigsChangedMessage) {
      unawaited(refreshCatalog());
      final activeSessionId = _selectedSessionId;
      if (activeSessionId != null) {
        unawaited(fetchAvailableAgents(activeSessionId));
      }
    } else if (msg is PermissionAskedMessage) {
      final list = _pendingPermissions.putIfAbsent(msg.sessionId, () => []);
      // Deduplicate by permissionId.
      if (!list.any((p) => p.permissionId == msg.permissionId)) {
        list.add(
          PendingPermission(
            sessionId: msg.sessionId,
            permissionId: msg.permissionId,
            toolName: msg.toolName,
            args: msg.args,
            summary: msg.summary,
          ),
        );
      }
      // #815: native notification when the user is not looking at this ask.
      final detail = msg.summary.trim().isNotEmpty
          ? msg.summary.trim()
          : 'Tool: ${msg.toolName}';
      _maybeNotifyAsk(
        dedupeKey: 'perm:${msg.sessionId}:${msg.permissionId}',
        sessionId: msg.sessionId,
        kindLabel: 'Permission requested',
        detail: detail,
      );
    } else if (msg is PermissionResolvedMessage) {
      _removePendingPermission(msg.sessionId, msg.permissionId);
      // #815: withdraw the ask notification now that it is answered.
      _withdrawAskNotification('perm:${msg.sessionId}:${msg.permissionId}');
    } else if (msg is QuestionAskedMessage) {
      // Store the authoritative question payload so the card can render even if
      // the tool-part input streamed in slowly (or not at all).
      if (msg.callId.isNotEmpty) {
        _questionsByCallId['${msg.sessionId}:${msg.callId}'] = msg.questions;
        _resolvedQuestionCallIds.remove('${msg.sessionId}:${msg.callId}');
      }
      // #815: native notification when the user is not looking at this ask.
      _maybeNotifyAsk(
        dedupeKey: 'q:${msg.sessionId}:${msg.requestId}',
        sessionId: msg.sessionId,
        kindLabel: 'Question',
        detail: _questionDetail(msg.questions),
      );
    } else if (msg is QuestionResolvedMessage) {
      // Resolved by us, another client, or the agent. Mark every tracked
      // callId for this session as resolved (we key local state by callId; the
      // resolved frame only carries requestId, so clear conservatively).
      _questionsByCallId.removeWhere((key, _) {
        if (key.startsWith('${msg.sessionId}:')) {
          _resolvedQuestionCallIds.add(key);
          return true;
        }
        return false;
      });
      // #815: withdraw the ask notification now that it is answered.
      _withdrawAskNotification('q:${msg.sessionId}:${msg.requestId}');
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
    } else if (msg is SessionCompactedMessage) {
      // #720: session.compacted — clear the compacting spinner and rehydrate the
      // session so the persisted CompactionPart renders as the divider live.
      handleSessionCompactedEvent(msg.id);
      return; // handleSessionCompactedEvent calls notifyListeners() itself.
    } else if (msg is VcsBranchUpdatedMessage) {
      // OCU-22 (#1063): project-scoped frame — refresh the selected session's
      // branch badge live (e.g. after `git checkout -b`).
      handleVcsBranchUpdatedEvent();
      return; // handleVcsBranchUpdatedEvent's fetch calls notifyListeners().
    } else if (msg is WorktreeReadyMessage) {
      // OCU-18 (#1059): project-scoped — surface a toast via the existing
      // agent-notification mechanism (same "background event completed"
      // pattern as SessionSpilloverMessage below).
      _notificationsController.pushAgentNotification(
        id: DateTime.now().millisecondsSinceEpoch,
        title: 'Worktree ready',
        body: msg.branch != null
            ? '"${msg.name}" is ready on branch ${msg.branch}.'
            : '"${msg.name}" is ready.',
      );
    } else if (msg is WorktreeFailedMessage) {
      _notificationsController.pushAgentNotification(
        id: DateTime.now().millisecondsSinceEpoch,
        title: 'Worktree failed',
        body: msg.message,
      );
    } else if (msg is SessionTodoUpdatedMessage) {
      // OPC-M3-5: todo.updated event — replace the session's todo state in-place.
      // State is keyed per session; an update for session B must not affect A.
      _sessionTodosBySession[msg.sessionId] = List.of(msg.todos);
    } else if (msg is SessionSpilloverMessage) {
      // Dual-account spillover: the engine failed this session over to the
      // other Anthropic account after a rate limit. Flip the badge and toast.
      _sessions = _sessions
          .map(
            (s) => s.id == msg.sessionId
                ? s.copyWith(anthropicAccountId: msg.toAccountId)
                : s,
          )
          .toList();
      final toLabel = AnthropicAccountsLabelCache.labelFor(msg.toAccountId);
      _notificationsController.pushAgentNotification(
        id: DateTime.now().millisecondsSinceEpoch,
        title: 'Claude account switched',
        body: 'Session hit a rate limit — continued on "$toLabel".',
      );
      // Inline transcript marker via the same local system-message append the
      // WsErrorMessage branch uses.
      final markerId =
          'spillover-${msg.sessionId}-${DateTime.now().millisecondsSinceEpoch}';
      (_chatMessagesBySession[msg.sessionId] ??= []).add(
        ChatMessage(
          id: markerId,
          sessionId: msg.sessionId,
          role: 'system',
          createdAt: DateTime.now().toUtc(),
        ),
      );
      _chatPartsByMessage[markerId] = [
        ChatPart(
          id: '${markerId}_text',
          messageId: markerId,
          type: 'text',
          text: '— continued on "$toLabel" after a rate limit —',
        ),
      ];
    }
    notifyListeners();
  }

  // --------------------------------------------------------------------------
  // Parts-based chat reducer (Opencode Desktop port)
  // --------------------------------------------------------------------------

  /// #761 — Create the assistant [ChatMessage] bubble for a live streaming part
  /// when no bubble exists yet for [messageId].
  ///
  /// The fork opencode engine's `message.updated` / `message.part.updated`
  /// SyncEvents do not reach the `/event` stream (only `message.part.delta`
  /// does), so the bubble that [_upsertChatMessage] would normally create from
  /// `message.updated` never arrives live. Without a bubble, the streamed parts
  /// accumulate in `_chatPartsByMessage` but have nothing to render under — the
  /// assistant response only appears after a REST refetch on session reselect.
  /// Synthesizing the bubble from the first live part renders the response while
  /// it streams. Safe because part events during a turn always belong to the
  /// assistant message; the user's message is inserted optimistically on send
  /// (role 'user') and is never the target of an unknown-message part event.
  void _ensureLiveAssistantMessage(String sessionId, String messageId) {
    if (sessionId.isEmpty || messageId.isEmpty) return;
    final existing = _chatMessagesBySession[sessionId];
    if (existing != null && existing.any((m) => m.id == messageId)) return;
    _upsertChatMessage(
      sessionId: sessionId,
      messageId: messageId,
      role: 'assistant',
    );
  }

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
    // Reconcile the optimistic insert (sendInput / sendCommand use a temporary
    // 'optimistic-*' id) with its server-authoritative echo. Without this the
    // same turn renders twice — once optimistically, once from message.updated
    // — because the ids never matched. Promote the optimistic message in place:
    // adopt the real id, re-key its parts, and keep its position + text so the
    // bubble doesn't flicker or blank out.
    final optIdx = list.indexWhere(
      (m) => m.role == role && m.id.startsWith('optimistic-'),
    );
    if (optIdx >= 0) {
      final opt = list[optIdx];
      // OCU-05 (#1046): the engine has now acknowledged this user message —
      // clear the "queued" chip.
      _queuedMessageIds.remove(opt.id);
      final optParts = _chatPartsByMessage.remove(opt.id);
      if (optParts != null && !_chatPartsByMessage.containsKey(messageId)) {
        _chatPartsByMessage[messageId] = optParts;
      }
      // The client's optimistic parts are authoritative for this turn; ignore
      // the server's echoed parts so the text isn't duplicated in the bubble.
      _clientAuthoredMessageIds.add(messageId);
      list[optIdx] = ChatMessage(
        id: messageId,
        sessionId: sessionId,
        role: role,
        createdAt: opt.createdAt,
        cost: cost ?? opt.cost,
        tokens: tokens ?? opt.tokens,
      );
      return;
    }
    list.add(
      ChatMessage(
        id: messageId,
        sessionId: sessionId,
        role: role,
        createdAt: DateTime.now().toUtc(),
        cost: cost,
        tokens: tokens,
      ),
    );
  }

  void _upsertChatPart({
    required String messageId,
    required String partId,
    required String type,
    required String text,
    Map<String, dynamic>? raw,
  }) {
    if (messageId.isEmpty || partId.isEmpty) return;
    // Skip server-echoed parts for client-authored turns (user input / slash
    // commands) — the optimistic parts already hold the exact content, so
    // adding the echo would duplicate the user's text inside the bubble.
    if (_clientAuthoredMessageIds.contains(messageId)) return;
    final list = _chatPartsByMessage.putIfAbsent(messageId, () => []);
    final idx = list.indexWhere((p) => p.id == partId);
    if (idx >= 0) {
      // Claude Code can deliver a reasoning delta before its part.updated
      // snapshot. That delayed snapshot is still empty, so preserve the text
      // already assembled from live deltas while adopting its real part type.
      list[idx].type = type;
      if (text.isNotEmpty || list[idx].text.isEmpty) {
        list[idx].text = text;
      }
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
        list.add(
          ChatPart(id: partId, messageId: messageId, type: 'text', text: delta),
        );
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
  // #815 — native notifications for agent permission/question asks
  // --------------------------------------------------------------------------

  /// Whether a native notification should fire for an ask in [sessionId].
  ///
  /// Suppressed only when the user is already looking at that ask: the app is
  /// frontmost (lifecycle resumed) AND the asking session is the one selected.
  /// Otherwise (app backgrounded, or a different/no session on screen) we
  /// notify. Mirrors the lifecycle predicate used by the completion-notify
  /// path so behavior stays consistent.
  @visibleForTesting
  bool shouldNotifyAsk(String sessionId) {
    final viewingThisAsk = _lifecycleState == AppLifecycleState.resumed &&
        _selectedSessionId == sessionId;
    return !viewingThisAsk;
  }

  /// Stable notification id derived from the per-ask dedupe key, so a withdraw
  /// cancels exactly the banner that was shown.
  int _askNotificationId(String dedupeKey) => dedupeKey.hashCode & 0x7FFFFFFF;

  String _sessionDisplayName(String sessionId) {
    final s = _sessions.firstWhereOrNull((x) => x.id == sessionId) ??
        _resumable.firstWhereOrNull((x) => x.id == sessionId);
    final name = s?.name.trim() ?? '';
    return name.isNotEmpty ? name : 'Agent session';
  }

  String _questionDetail(List<dynamic> questions) {
    for (final q in questions) {
      if (q is Map) {
        for (final key in const ['question', 'text', 'prompt', 'title']) {
          final v = q[key];
          if (v is String && v.trim().isNotEmpty) return v.trim();
        }
      } else if (q is String && q.trim().isNotEmpty) {
        return q.trim();
      }
    }
    return 'Waiting for your answer';
  }

  static String _truncate(String s, [int max = 140]) =>
      s.length <= max ? s : '${s.substring(0, max - 1)}…';

  /// Fire a native ask notification unless the user is already viewing the ask
  /// or one was already fired for this exact ask (dedupe). The body is
  /// truncated. Failures are swallowed by the notification service (fail-soft).
  void _maybeNotifyAsk({
    required String dedupeKey,
    required String sessionId,
    required String kindLabel,
    required String detail,
  }) {
    if (!shouldNotifyAsk(sessionId)) return;
    if (!_notifiedAsks.add(dedupeKey)) return; // already notified this ask
    _notificationService.showAgentAskNotification(
      id: _askNotificationId(dedupeKey),
      title: '${_sessionDisplayName(sessionId)} — $kindLabel',
      body: _truncate(detail),
      payload: 'agentSession:$sessionId',
    );
  }

  /// Withdraw a previously-shown ask notification and clear its dedupe entry.
  void _withdrawAskNotification(String dedupeKey) {
    if (!_notifiedAsks.remove(dedupeKey)) return; // nothing was shown
    _notificationService.cancel(_askNotificationId(dedupeKey));
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
    // Tear down every live terminal (kills its PTY exactly once) so no PTY is
    // leaked when the controller goes away.
    for (final term in _terminals.values) {
      term.dispose();
    }
    _terminals.clear();
    _repository.dispose();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/// #1090 — the single place that classifies a session into an
/// [AgentSessionScope]. Mirrors the server-side `?scope=` filter
/// (`agent_sessions_repository.ts`: chats = `category='chat' AND
/// is_system=0`; scheduled = `category='scheduled'`; self_improvement =
/// `category='self_improvement'`). A full [AgentsController.load] already
/// gets a correctly-scoped list from the server; the live WS channel is
/// shared across every scope, so both `_onWsMessage` incremental branches
/// (session.created / session.updated) call this before admitting a session
/// into the currently-viewed list — otherwise a background/scheduled/
/// self_improvement session would leak into whichever scope is open.
bool _belongsToScope(AgentSession session, AgentSessionScope scope) {
  switch (scope) {
    case AgentSessionScope.chats:
      return !session.isSystem && session.category == 'chat';
    case AgentSessionScope.scheduled:
      return session.category == 'scheduled';
    case AgentSessionScope.selfImprovement:
      return session.category == 'self_improvement';
  }
}

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
