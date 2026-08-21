import '../data/org_proposals_data_source.dart';
import '../models/org_proposal.dart';

class OrgProposalsRepository {
  OrgProposalsRepository(this._dataSource);

  final OrgProposalsDataSource _dataSource;

  Future<List<OrgProposal>> listProposed({String status = 'proposed'}) =>
      _dataSource.listProposed(status: status);

  Future<OrgProposal> approve(
    String id, {
    int? decidedByUserId,
    bool conditionalToolSafetyConfirmation = false,
  }) =>
      _dataSource.approve(
        id,
        decidedByUserId: decidedByUserId,
        conditionalToolSafetyConfirmation: conditionalToolSafetyConfirmation,
      );

  Future<OrgProposal> revert(String id) => _dataSource.revert(id);

  Future<OrgProposal> reject(String id, {int? decidedByUserId}) =>
      _dataSource.reject(id, decidedByUserId: decidedByUserId);
}
