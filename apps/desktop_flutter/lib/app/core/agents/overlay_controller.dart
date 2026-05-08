import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../features/agents/controllers/agents_controller.dart';
import '../../../features/agents/models/agent_session.dart';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

enum BubbleKind { session, trigger }

class AgentBubbleEntry {
  AgentBubbleEntry({
    required this.key,
    required this.kind,
    required this.label,
    this.subtitle,
    this.agentId,
    this.status,
    required this.working,
    this.sessionId,
    this.triggerTaskId,
    required this.isExpanded,
  });

  final String key;
  final BubbleKind kind;
  final String label;
  final String? subtitle;
  final String? agentId;
  final AgentSessionStatus? status;
  final bool working;
  final String? sessionId;
  final String? triggerTaskId;
  bool isExpanded;

  AgentBubbleEntry copyWith({
    String? key,
    BubbleKind? kind,
    String? label,
    Object? subtitle = _sentinel,
    Object? agentId = _sentinel,
    Object? status = _sentinel,
    bool? working,
    Object? sessionId = _sentinel,
    Object? triggerTaskId = _sentinel,
    bool? isExpanded,
  }) {
    return AgentBubbleEntry(
      key: key ?? this.key,
      kind: kind ?? this.kind,
      label: label ?? this.label,
      subtitle: subtitle == _sentinel ? this.subtitle : subtitle as String?,
      agentId: agentId == _sentinel ? this.agentId : agentId as String?,
      status: status == _sentinel ? this.status : status as AgentSessionStatus?,
      working: working ?? this.working,
      sessionId: sessionId == _sentinel ? this.sessionId : sessionId as String?,
      triggerTaskId: triggerTaskId == _sentinel
          ? this.triggerTaskId
          : triggerTaskId as String?,
      isExpanded: isExpanded ?? this.isExpanded,
    );
  }
}

const Object _sentinel = Object();

// ---------------------------------------------------------------------------
// OverlayController
// ---------------------------------------------------------------------------

class OverlayController extends ChangeNotifier {
  OverlayController(this._agentsController) {
    _agentsController.addListener(_sync);
    _sync();
    _loadKnownSessionIdsFromPrefs();
  }

  final AgentsController _agentsController;

  List<AgentBubbleEntry> _bubbles = [];

  /// Maximum number of visible bubbles before the overflow chip is shown.
  static const int maxVisible = 3;

  List<AgentBubbleEntry> get visibleBubbles =>
      _bubbles.take(maxVisible).toList();
  int get overflow => (_bubbles.length - maxVisible).clamp(0, 9999);
  int get totalCount => _bubbles.length;

  /// When non-null, AppShell should navigate to this index and then call
  /// [clearPendingNavIndex].
  int? _pendingNavIndex;
  int? get pendingNavIndex => _pendingNavIndex;

  /// Call from AppShell after handling the navigation.
  void clearPendingNavIndex() {
    _pendingNavIndex = null;
    // No notifyListeners — no rebuild needed.
  }

  /// Request a navigation to [index] (e.g. AppConstants.navAgents).
  void requestNav(int index) {
    _pendingNavIndex = index;
    notifyListeners();
  }

  // --------------------------------------------------------------------------
  // Bubble management
  // --------------------------------------------------------------------------

  void _sync() {
    final next = <AgentBubbleEntry>[];

    // Active sessions first (collapsed by default)
    for (final s in _agentsController.sessions) {
      next.add(AgentBubbleEntry(
        key: s.id,
        kind: BubbleKind.session,
        label: s.name,
        subtitle: s.taskId != null ? 'Task linked' : null,
        agentId: s.agentId,
        status: s.status,
        working: _agentsController.isWorking(s.id),
        sessionId: s.id,
        triggerTaskId: null,
        isExpanded: _existingIsExpanded(s.id, defaultValue: false),
      ));
    }

    // Pending triggers next (expanded by default to draw attention)
    for (final t in _agentsController.pendingTriggers) {
      final key = 'trigger:${t.taskId}';
      next.add(AgentBubbleEntry(
        key: key,
        kind: BubbleKind.trigger,
        label: t.taskTitle,
        subtitle: 'Pick an agent',
        agentId: null,
        status: null,
        working: false,
        sessionId: null,
        triggerTaskId: t.taskId,
        isExpanded: _existingIsExpanded(key, defaultValue: true),
      ));
    }

    _bubbles = next;
    _persistKnownSessionIds();
    notifyListeners();
  }

  bool _existingIsExpanded(String key, {required bool defaultValue}) {
    for (final b in _bubbles) {
      if (b.key == key) return b.isExpanded;
    }
    return defaultValue;
  }

  void toggleExpand(String key) {
    final i = _bubbles.indexWhere((b) => b.key == key);
    if (i < 0) return;
    _bubbles[i] = _bubbles[i].copyWith(isExpanded: !_bubbles[i].isExpanded);
    notifyListeners();
  }

  void collapseAll() {
    _bubbles = _bubbles.map((b) => b.copyWith(isExpanded: false)).toList();
    notifyListeners();
  }

  void dismissTriggerBubble(String taskId) {
    _agentsController.dismissTrigger(taskId);
    // _sync() will fire via the listener and remove the entry.
  }

  // --------------------------------------------------------------------------
  // SharedPreferences persistence (best-effort)
  // --------------------------------------------------------------------------

  Future<void> _persistKnownSessionIds() async {
    try {
      final ids = _bubbles
          .where((b) => b.kind == BubbleKind.session)
          .map((b) => b.sessionId!)
          .toList();
      final prefs = await SharedPreferences.getInstance();
      await prefs.setStringList('agent.known_session_ids', ids);
    } catch (_) {
      // Best-effort; ignore errors.
    }
  }

  Future<void> _loadKnownSessionIdsFromPrefs() async {
    // Best-effort restore hint. The authoritative session list always comes
    // from the server's `sessions.list` WebSocket message when the WS
    // reconnects. We do not synthesise placeholder bubbles here — we simply
    // ensure the call doesn't throw so the controller initialises cleanly.
    try {
      await SharedPreferences.getInstance();
    } catch (_) {}
  }

  // --------------------------------------------------------------------------
  // Dispose
  // --------------------------------------------------------------------------

  @override
  void dispose() {
    _agentsController.removeListener(_sync);
    super.dispose();
  }
}
