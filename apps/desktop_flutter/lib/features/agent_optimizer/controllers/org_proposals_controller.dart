import 'package:flutter/foundation.dart';

import '../models/org_proposal.dart';
import '../repositories/org_proposals_repository.dart';
import '../../../app/core/errors/app_error.dart';

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
  int _reviewGeneration = 0;

  List<OrgProposal> get proposals => List.unmodifiable(_proposals);
  OrgProposalsStatus get status => _status;
  String? get error => _error;

  bool isPending(String id) => _pendingIds.contains(id);
  int get reviewGeneration => _reviewGeneration;

  Future<void> refresh() async {
    // A review can be superseded even when its replacement refresh fails.
    // This prevents a confirmation dialog from approving based on stale state.
    _reviewGeneration += 1;
    _status = OrgProposalsStatus.loading;
    _error = null;
    notifyListeners();

    try {
      // D1.5 tool installs leave `proposed` for sandbox-vetted/pending before
      // a human can act. Keep the old queue intact while including those two
      // review states; dedupe protects older fakes/servers that ignore status.
      final batches = await Future.wait([
        _repository.listProposed(status: 'proposed'),
        _repository.listProposed(status: 'sandbox-vetted'),
        _repository.listProposed(status: 'pending'),
      ]);
      final seen = <String>{};
      _proposals = batches
          .expand((batch) => batch)
          .where((proposal) => seen.add(proposal.id))
          .toList();
      _status = OrgProposalsStatus.idle;
    } catch (e) {
      _error = e.toString();
      _status = OrgProposalsStatus.error;
    }
    notifyListeners();
  }

  // ---------------------------------------------------------------------
  // Applied (already-live) changes — the revert lane.
  //
  // The server's status filter takes ONE status per call, so the live set is
  // three reads. `active` is the kept steady state; `applied`/`measuring` are
  // the earlier stages of the same deployment — already changing behaviour, so
  // they belong on this tab too, even though only `active` may be reverted.
  // ---------------------------------------------------------------------

  static const appliedStatuses = ['active', 'applied', 'measuring'];

  List<OrgProposal> _applied = [];
  OrgProposalsStatus _appliedStatus = OrgProposalsStatus.idle;
  String? _appliedError;

  List<OrgProposal> get applied => List.unmodifiable(_applied);
  OrgProposalsStatus get appliedStatus => _appliedStatus;
  String? get appliedError => _appliedError;

  Future<void> refreshApplied() async {
    _appliedStatus = OrgProposalsStatus.loading;
    _appliedError = null;
    notifyListeners();

    try {
      final batches = await Future.wait(
        appliedStatuses.map((s) => _repository.listProposed(status: s)),
      );
      _applied = batches.expand((batch) => batch).toList();
      _appliedStatus = OrgProposalsStatus.idle;
    } catch (e) {
      _appliedError = e is AppError ? e.message : e.toString();
      _appliedStatus = OrgProposalsStatus.error;
    }
    notifyListeners();
  }

  /// Undo an already-live change. Returns true only when the server confirms
  /// the revert; on refusal [appliedError] holds the SERVER's message (the
  /// client-side [OrgProposal.revertNeedsOperator] check is a UX aid, never
  /// the guarantee — the server is the authority on what may be reverted).
  Future<bool> revert(String id) async {
    _pendingIds.add(id);
    _appliedError = null;
    notifyListeners();
    try {
      await _repository.revert(id);
      _applied = _applied.where((p) => p.id != id).toList();
      return true;
    } catch (e) {
      _appliedError = e is AppError ? e.message : e.toString();
      return false;
    } finally {
      _pendingIds.remove(id);
      notifyListeners();
    }
  }

  /// True when the last approve failed because the server durably recorded the
  /// operation as `reconciliation-required`. That is NOT an ordinary failure to
  /// retry: the proposal, the target scope and the projected profile have to be
  /// inspected first, so the UI must say something different from "try again".
  bool _lastApproveNeedsReconciliation = false;
  bool get lastApproveNeedsReconciliation => _lastApproveNeedsReconciliation;

  Future<bool> approve(
    String id, {
    int? decidedByUserId,
    bool conditionalToolSafetyConfirmation = false,
  }) async {
    _pendingIds.add(id);
    _lastApproveNeedsReconciliation = false;
    notifyListeners();
    try {
      await _repository.approve(
        id,
        decidedByUserId: decidedByUserId,
        conditionalToolSafetyConfirmation: conditionalToolSafetyConfirmation,
      );
      _proposals = _proposals.where((p) => p.id != id).toList();
      _error = null;
      return true;
    } catch (e) {
      _error = e is AppError ? e.message : e.toString();
      // Discriminate on the machine-readable code, not on server prose. A
      // CONFLICT is retryable; RECONCILIATION_REQUIRED is a durably-recorded
      // unresolved operation that a human has to inspect first.
      _lastApproveNeedsReconciliation =
          e is AppError && e.code == 'RECONCILIATION_REQUIRED';
      // The server may have moved this row out of `proposed` even though the
      // approve did not succeed — a released claim becomes `failed`, an
      // unprovable one becomes `reconciliation-required`. Re-reading keeps the
      // queue from showing a proposal that is no longer in it.
      try {
        _proposals = await _repository.listProposed();
      } catch (_) {
        // Leave the cached list alone; the error above is the one that matters.
      }
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
