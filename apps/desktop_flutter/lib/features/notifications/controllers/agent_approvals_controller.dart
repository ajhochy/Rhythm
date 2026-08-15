import 'dart:async';
import 'package:flutter/foundation.dart';

import '../../../app/core/notifications/local_notification_service.dart';
import '../data/agent_approvals_data_source.dart';
import '../models/agent_approval.dart';

/// #895 — polls pending agent approvals so the notification panel can
/// surface approve/reject cards for high-stakes agent actions.
class AgentApprovalsController extends ChangeNotifier {
  static const _pollInterval = Duration(seconds: 5);

  AgentApprovalsController(
    this._dataSource, {
    LocalNotificationService? notifications,
  }) : _notifications = notifications;

  final AgentApprovalsDataSource _dataSource;
  final LocalNotificationService? _notifications;

  List<AgentApproval> _pending = [];
  Timer? _pollingTimer;
  final Set<String> _notifiedApprovalIds = {};
  String? _focusedApprovalId;

  List<AgentApproval> get pending => List.unmodifiable(_pending);
  String? get focusedApprovalId => _focusedApprovalId;

  void startPolling() {
    _pollingTimer?.cancel();
    _poll();
    _pollingTimer = Timer.periodic(_pollInterval, (_) => _poll());
  }

  void stopPolling() {
    _pollingTimer?.cancel();
    _pollingTimer = null;
  }

  Future<void> _poll() async {
    try {
      final next = await _dataSource.listPending();
      final nextIds = next.map((approval) => approval.id).toSet();
      final resolvedIds = _notifiedApprovalIds.difference(nextIds);
      for (final id in resolvedIds) {
        final notifications = _notifications;
        if (notifications != null) {
          unawaited(notifications.cancel(_approvalNotificationId(id)));
        }
      }
      _notifiedApprovalIds.removeAll(resolvedIds);

      for (final approval in next) {
        final sessionId = approval.sessionId;
        if (sessionId == null || sessionId.isEmpty) continue;
        final notifications = _notifications;
        if (notifications == null) continue;
        if (!_notifiedApprovalIds.add(approval.id)) continue;
        unawaited(
          notifications.showAgentAskNotification(
            id: _approvalNotificationId(approval.id),
            title: 'Approval requested',
            body: approval.action,
            payload: 'agentApproval:$sessionId:${approval.id}',
          ),
        );
      }

      _pending = next;
      notifyListeners();
    } catch (error) {
      // The local agent server may not be ready yet on the first few polls
      // (same convention as NotificationsController), but a persistent
      // failure here (401/403/network) must not be silent — it is the only
      // fetch path for security-bound approval cards, and a swallowed error
      // is indistinguishable from "no approvals exist".
      debugPrint('AgentApprovalsController poll failed: $error');
    }
  }

  Future<void> approve(String id) async {
    await _decide(id, approve: true);
  }

  Future<void> reject(String id) async {
    await _decide(id, approve: false);
  }

  Future<void> _decide(String id, {required bool approve}) async {
    try {
      final approval = _pending.firstWhere((item) => item.id == id);
      await _dataSource.decide(approval, approve: approve);
      _pending = _pending.where((a) => a.id != id).toList();
      final hadNativeNotification = _notifiedApprovalIds.remove(id);
      if (_focusedApprovalId == id) _focusedApprovalId = null;
      if (hadNativeNotification) {
        final notifications = _notifications;
        if (notifications != null) {
          unawaited(notifications.cancel(_approvalNotificationId(id)));
        }
      }
      notifyListeners();
    } catch (_) {
      // Leave the card in place so the user can retry.
    }
  }

  int _approvalNotificationId(String approvalId) =>
      approvalId.hashCode & 0x7FFFFFFF;

  /// Records the exact approval requested by native-notification navigation.
  /// The inline transcript surface consumes this to reveal/focus that card.
  void focusApproval(String approvalId) {
    if (_focusedApprovalId == approvalId) return;
    _focusedApprovalId = approvalId;
    notifyListeners();
  }

  void clearFocusedApproval() {
    if (_focusedApprovalId == null) return;
    _focusedApprovalId = null;
    notifyListeners();
  }

  @override
  void dispose() {
    stopPolling();
    super.dispose();
  }
}
