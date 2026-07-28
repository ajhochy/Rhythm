import 'dart:async';
import 'package:flutter/foundation.dart';

import '../data/agent_approvals_data_source.dart';
import '../models/agent_approval.dart';

/// #895 — polls pending agent approvals so the notification panel can
/// surface approve/reject cards for high-stakes agent actions.
class AgentApprovalsController extends ChangeNotifier {
  AgentApprovalsController(this._dataSource);

  final AgentApprovalsDataSource _dataSource;

  List<AgentApproval> _pending = [];
  Timer? _pollingTimer;

  List<AgentApproval> get pending => List.unmodifiable(_pending);

  void startPolling() {
    _pollingTimer?.cancel();
    _poll();
    _pollingTimer = Timer.periodic(const Duration(seconds: 30), (_) => _poll());
  }

  void stopPolling() {
    _pollingTimer?.cancel();
    _pollingTimer = null;
  }

  Future<void> _poll() async {
    try {
      _pending = await _dataSource.listPending();
      notifyListeners();
    } catch (_) {
      // Silently ignore polling errors — the local agent server may not be
      // ready yet, same convention as NotificationsController.
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
      notifyListeners();
    } catch (_) {
      // Leave the card in place so the user can retry.
    }
  }

  @override
  void dispose() {
    stopPolling();
    super.dispose();
  }
}
