import 'package:flutter/foundation.dart';

import '../models/org_proposal.dart';
import '../repositories/org_proposals_repository.dart';

enum OrgProposalsStatus { idle, loading, error }

class OrgProposalsController extends ChangeNotifier {
  OrgProposalsController(this._repository);

  final OrgProposalsRepository _repository;

  List<OrgProposal> _proposals = [];
  OrgProposalsStatus _status = OrgProposalsStatus.idle;
  String? _error;

  /// ids currently mid-flight for approve/reject, so the view can show a
  /// per-row spinner and disable the buttons for just that row.
  final Set<String> _pendingIds = {};

  List<OrgProposal> get proposals => List.unmodifiable(_proposals);
  OrgProposalsStatus get status => _status;
  String? get error => _error;

  bool isPending(String id) => _pendingIds.contains(id);

  Future<void> refresh() async {
    _status = OrgProposalsStatus.loading;
    _error = null;
    notifyListeners();

    try {
      _proposals = await _repository.listProposed();
      _status = OrgProposalsStatus.idle;
    } catch (e) {
      _error = e.toString();
      _status = OrgProposalsStatus.error;
    }
    notifyListeners();
  }

  Future<bool> approve(String id, {int? decidedByUserId}) async {
    _pendingIds.add(id);
    notifyListeners();
    try {
      await _repository.approve(id, decidedByUserId: decidedByUserId);
      _proposals = _proposals.where((p) => p.id != id).toList();
      _error = null;
      return true;
    } catch (e) {
      _error = e.toString();
      return false;
    } finally {
      _pendingIds.remove(id);
      notifyListeners();
    }
  }

  Future<bool> reject(String id, {int? decidedByUserId}) async {
    _pendingIds.add(id);
    notifyListeners();
    try {
      await _repository.reject(id, decidedByUserId: decidedByUserId);
      _proposals = _proposals.where((p) => p.id != id).toList();
      _error = null;
      return true;
    } catch (e) {
      _error = e.toString();
      return false;
    } finally {
      _pendingIds.remove(id);
      notifyListeners();
    }
  }
}
