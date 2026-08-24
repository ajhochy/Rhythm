/// Human-gate review queue surface (org-optimizer-11, #827).
///
/// Per the 2026-07-02 policy update, this screen is the EXCEPTION path — only
/// `create-agent` and `external-adoption`/`webhook-wiring` proposals
/// realistically ever reach `status == 'proposed'`; most proposals flow
/// through the auto-apply lane (org-optimizer-05) and never appear here.
///
/// Safety note: the Approve button's disabled state for external-adoption /
/// webhook-wiring proposals lacking a provenance/security note is a UX aid
/// only. The real gate is server-side (#826's `requiresSecurityNote` /
/// `hasSecurityNote` check) — this UI must never offer an approve path that
/// bypasses it.
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/org_proposals_controller.dart';
import '../models/org_proposal.dart';

class OrgProposalsView extends StatefulWidget {
  const OrgProposalsView({super.key});

  @override
  State<OrgProposalsView> createState() => _OrgProposalsViewState();
}

class _OrgProposalsViewState extends State<OrgProposalsView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<OrgProposalsController>().refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<OrgProposalsController>(
      builder: (context, controller, _) {
        return DefaultTabController(
          length: 2,
          child: Scaffold(
            backgroundColor: context.rhythm.canvas,
            appBar: AppBar(
              backgroundColor: context.rhythm.surface,
              elevation: 0,
              title: Text(
                'Review Queue',
                style: TextStyle(
                  color: context.rhythm.textPrimary,
                  fontWeight: FontWeight.w700,
                  fontSize: 17,
                ),
              ),
              iconTheme: IconThemeData(color: context.rhythm.textSecondary),
              actions: [
                IconButton(
                  icon: Icon(
                    Icons.refresh,
                    color: context.rhythm.textSecondary,
                  ),
                  tooltip: 'Refresh',
                  onPressed: () {
                    controller.refresh();
                    controller.refreshApplied();
                  },
                ),
                const SizedBox(width: 8),
              ],
              bottom: TabBar(
                labelColor: context.rhythm.accent,
                unselectedLabelColor: context.rhythm.textSecondary,
                indicatorColor: context.rhythm.accent,
                tabs: const [
                  Tab(
                    key: ValueKey('org-proposals-tab-review'),
                    text: 'Waiting for you',
                  ),
                  Tab(
                    key: ValueKey('org-proposals-tab-applied'),
                    text: 'Already in use',
                  ),
                ],
              ),
            ),
            body: TabBarView(
              children: [_buildBody(context, controller), const _AppliedTab()],
            ),
          ),
        );
      },
    );
  }

  Widget _buildBody(BuildContext context, OrgProposalsController controller) {
    if (controller.status == OrgProposalsStatus.loading &&
        controller.proposals.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (controller.status == OrgProposalsStatus.error &&
        controller.error != null &&
        controller.proposals.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, color: context.rhythm.danger, size: 40),
            const SizedBox(height: 12),
            Text(
              controller.error!,
              style: TextStyle(color: context.rhythm.textSecondary),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: controller.refresh,
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    if (controller.proposals.isEmpty) {
      return Center(
        key: const ValueKey('org-proposals-empty-state'),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.fact_check_outlined,
              size: 56,
              color: context.rhythm.textMuted,
            ),
            const SizedBox(height: 16),
            Text(
              'Nothing waiting for review',
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w600,
                color: context.rhythm.textSecondary,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'New-agent and external-adoption proposals will show up here.',
              style: TextStyle(fontSize: 14, color: context.rhythm.textMuted),
            ),
          ],
        ),
      );
    }

    return ListView.separated(
      key: const ValueKey('org-proposals-list'),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      itemCount: controller.proposals.length,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        final proposal = controller.proposals[index];
        return _ProposalCard(
          key: ValueKey('proposal-card-${proposal.id}'),
          proposal: proposal,
          pending: controller.isPending(proposal.id),
          onApprove: () => _approve(context, controller, proposal),
          onReject: () => _reject(context, controller, proposal),
        );
      },
    );
  }

  Future<void> _approve(
    BuildContext context,
    OrgProposalsController controller,
    OrgProposal proposal,
  ) async {
    final safety = proposal.toolSafety;
    var conditionalConfirmation = false;
    if (proposal.kind == 'tool-install' &&
        safety?.needsConditionalConfirmation == true) {
      final generation = controller.reviewGeneration;
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogCtx) => AlertDialog(
          title: const Text('Approve conditional tool install?'),
          content: const Text(
            'The sandbox observed conditions that need your explicit approval. '
            'Approve only if you understand the listed safety report.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogCtx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              key: ValueKey('confirm-conditional-approve-${proposal.id}'),
              onPressed: () => Navigator.pop(dialogCtx, true),
              child: const Text('Approve conditional install'),
            ),
          ],
        ),
      );
      if (confirmed != true || !mounted) return;
      // A dialog cannot carry confirmation through a refresh. The user must
      // reopen it against the fresh, durable report instead.
      if (controller.reviewGeneration != generation) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text(
              'The proposal changed. Review the latest safety report before approving.'),
          behavior: SnackBarBehavior.floating,
        ));
        return;
      }
      conditionalConfirmation = true;
    }
    final ok = await controller.approve(
      proposal.id,
      conditionalToolSafetyConfirmation: conditionalConfirmation,
    );
    if (!mounted) return;
    // A reconciliation outcome is neither success nor a retryable failure: the
    // database, the target scope and the projected profile disagree and a human
    // has to look. Saying "Approve failed" would invite exactly the retry that
    // must not happen.
    final needsReconciliation = controller.lastApproveNeedsReconciliation;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          ok
              ? 'Proposal approved'
              : needsReconciliation
                  ? 'Needs reconciliation — inspect the proposal, its target '
                      'scope and the projected profile before retrying'
                  : (controller.error ?? 'Approve failed'),
        ),
        backgroundColor: ok
            ? context.rhythm.success
            : needsReconciliation
                ? context.rhythm.warning
                : context.rhythm.danger,
        behavior: SnackBarBehavior.floating,
        duration: Duration(seconds: needsReconciliation ? 6 : 2),
      ),
    );
  }

  Future<void> _reject(
    BuildContext context,
    OrgProposalsController controller,
    OrgProposal proposal,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        backgroundColor: context.rhythm.surfaceRaised,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(RhythmRadius.lg),
          side: BorderSide(color: context.rhythm.border),
        ),
        title: Text(
          'Reject proposal?',
          style: TextStyle(
            color: context.rhythm.textPrimary,
            fontWeight: FontWeight.w700,
          ),
        ),
        content: Text(
          '"${proposal.title}" will be rejected and will not be re-proposed.',
          style: TextStyle(color: context.rhythm.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogCtx, false),
            child: Text(
              'Cancel',
              style: TextStyle(color: context.rhythm.textSecondary),
            ),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: context.rhythm.danger,
            ),
            onPressed: () => Navigator.pop(dialogCtx, true),
            child: const Text('Reject'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    final ok = await controller.reject(proposal.id);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          ok ? 'Proposal rejected' : (controller.error ?? 'Reject failed'),
        ),
        backgroundColor: ok ? context.rhythm.success : context.rhythm.danger,
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 2),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Already-in-use tab (#857 revert lane)
//
// Two facts per row, kept deliberately apart: WHERE the change is in its
// rollout (`status`) and WHETHER it has been shown to help (`outcomeStatus`).
// A change is routinely live and unmeasured at the same time; one merged
// label would state a verdict the engine has not reached.
//
// Revert is offered only for rows the server can actually undo. The check is
// a UX aid — the server stays the authority, and its refusal message is shown
// verbatim when a revert is refused anyway.
// ---------------------------------------------------------------------------

/// Plain language for non-technical staff. `unproven` is the honest state of
/// nearly every row today (nothing has been measured yet) — it must read as
/// "not measured", never as a negative verdict.
String _outcomeLabel(String outcomeStatus) {
  switch (outcomeStatus) {
    case 'verified':
      return 'Checked — it helped';
    case 'regressed':
      return 'Checked — it made things worse';
    case 'inconclusive':
      return 'Checked, but no clear difference';
    default:
      return 'Not measured yet';
  }
}

String _deploymentLabel(String status) {
  switch (status) {
    case 'applied':
      return 'Just turned on';
    case 'measuring':
      return 'In use now, being checked';
    default:
      return 'In use now';
  }
}

/// C6-3 — plain language for the additive experiment summary. Kept in the
/// same "never a negative-sounding default" style as [_outcomeLabel].
String _collectingProgressLabel(String progress) {
  switch (progress) {
    case 'collecting':
      return 'Still gathering results';
    case 'decided':
      return 'Finished testing';
    default:
      return 'Not tested yet';
  }
}

String _treatmentIntegrityLabel(String status) {
  switch (status) {
    case 'ok':
      return 'Working normally';
    case 'degraded':
      return 'Some test runs failed to apply';
    default:
      return 'Not enough data yet';
  }
}

String _guardrailStatusLabel(String status) {
  switch (status) {
    case 'ok':
      return 'No safety limits triggered';
    case 'breached':
      return 'A safety limit was triggered';
    default:
      return 'Not enough data yet';
  }
}

String? _shortSha256(String? hash) {
  if (hash == null || !RegExp(r'^[0-9a-fA-F]{64}$').hasMatch(hash)) return null;
  return 'sha256:${hash.substring(0, 12).toLowerCase()}';
}

class _AppliedTab extends StatefulWidget {
  const _AppliedTab();

  @override
  State<_AppliedTab> createState() => _AppliedTabState();
}

class _AppliedTabState extends State<_AppliedTab> {
  @override
  void initState() {
    super.initState();
    // The tab body is only built once the tab is opened, so this is also the
    // lazy load: the review queue costs no extra requests until then.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<OrgProposalsController>().refreshApplied();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<OrgProposalsController>(
      builder: (context, controller, _) {
        if (controller.appliedStatus == OrgProposalsStatus.loading &&
            controller.applied.isEmpty) {
          return const Center(child: CircularProgressIndicator());
        }

        if (controller.appliedStatus == OrgProposalsStatus.error &&
            controller.applied.isEmpty) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.error_outline,
                  color: context.rhythm.danger,
                  size: 40,
                ),
                const SizedBox(height: 12),
                Text(
                  controller.appliedError ?? 'Could not load applied changes',
                  style: TextStyle(color: context.rhythm.textSecondary),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: controller.refreshApplied,
                  child: const Text('Try again'),
                ),
              ],
            ),
          );
        }

        if (controller.applied.isEmpty) {
          return Center(
            key: const ValueKey('applied-proposals-empty-state'),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.done_all, size: 56, color: context.rhythm.textMuted),
                const SizedBox(height: 16),
                Text(
                  'No changes are in use yet',
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w600,
                    color: context.rhythm.textSecondary,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Changes you approve will show up here once they go live.',
                  style: TextStyle(
                    fontSize: 14,
                    color: context.rhythm.textMuted,
                  ),
                ),
              ],
            ),
          );
        }

        return ListView.separated(
          key: const ValueKey('applied-proposals-list'),
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          itemCount: controller.applied.length,
          separatorBuilder: (_, __) => const SizedBox(height: 12),
          itemBuilder: (context, index) {
            final proposal = controller.applied[index];
            return _AppliedCard(
              key: ValueKey('applied-card-${proposal.id}'),
              proposal: proposal,
              pending: controller.isPending(proposal.id),
              onRevert: () => _revert(context, controller, proposal),
            );
          },
        );
      },
    );
  }

  Future<void> _revert(
    BuildContext context,
    OrgProposalsController controller,
    OrgProposal proposal,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        backgroundColor: context.rhythm.surfaceRaised,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(RhythmRadius.lg),
          side: BorderSide(color: context.rhythm.border),
        ),
        title: Text(
          'Undo this change?',
          style: TextStyle(
            color: context.rhythm.textPrimary,
            fontWeight: FontWeight.w700,
          ),
        ),
        content: Text(
          '"${proposal.title}" will be put back the way it was before.',
          style: TextStyle(color: context.rhythm.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogCtx, false),
            child: Text(
              'Cancel',
              style: TextStyle(color: context.rhythm.textSecondary),
            ),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: context.rhythm.danger,
            ),
            onPressed: () => Navigator.pop(dialogCtx, true),
            child: const Text('Undo change'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    final ok = await controller.revert(proposal.id);
    if (!mounted) return;
    // On refusal the SERVER's message is the message. It names the actual
    // reason (wrong state, legacy snapshot, reconciliation) far better than
    // any generic "Revert failed" the client could invent.
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          ok
              ? 'Change undone'
              : (controller.appliedError ??
                  'The change could not be undone. Nothing was altered.'),
        ),
        backgroundColor: ok ? context.rhythm.success : context.rhythm.warning,
        behavior: SnackBarBehavior.floating,
        duration: Duration(seconds: ok ? 2 : 8),
      ),
    );
  }
}

class _AppliedCard extends StatelessWidget {
  const _AppliedCard({
    super.key,
    required this.proposal,
    required this.pending,
    required this.onRevert,
  });

  final OrgProposal proposal;
  final bool pending;
  final VoidCallback onRevert;

  @override
  Widget build(BuildContext context) {
    // Only `active` rows are revertable at all (server state machine), and of
    // those only the ones carrying a versioned rollback record.
    final canRevert =
        proposal.status == 'active' && !proposal.revertNeedsOperator;
    final testedBaseline =
        _shortSha256(proposal.experimentSummary?.testedBaselineHash);
    final testedCandidate =
        _shortSha256(proposal.experimentSummary?.testedCandidateHash);

    return Container(
      decoration: BoxDecoration(
        color: context.rhythm.surface,
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        border: Border.all(color: context.rhythm.border),
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _KindBadge(kind: proposal.kind),
          const SizedBox(height: 10),
          Text(
            proposal.title,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: context.rhythm.textPrimary,
            ),
          ),
          if (proposal.rationale != null &&
              proposal.rationale!.trim().isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              proposal.rationale!,
              style: TextStyle(
                fontSize: 13,
                color: context.rhythm.textSecondary,
              ),
            ),
          ],
          const SizedBox(height: 12),
          _FactRow(label: 'Status', value: _deploymentLabel(proposal.status)),
          const SizedBox(height: 4),
          _FactRow(
            label: 'Is it helping?',
            value: _outcomeLabel(proposal.outcomeStatus),
          ),
          if (proposal.experimentSummary?.hasExperiment ?? false) ...[
            const SizedBox(height: 4),
            _FactRow(
              label: 'Testing',
              value: _collectingProgressLabel(
                proposal.experimentSummary!.collectingProgress,
              ),
            ),
            const SizedBox(height: 4),
            _FactRow(
              label: 'Checked runs',
              value: '${proposal.experimentSummary!.eligibleCount} ok, '
                  '${proposal.experimentSummary!.missingCount} missing',
            ),
            const SizedBox(height: 4),
            _FactRow(
              label: 'Reliability',
              value: _treatmentIntegrityLabel(
                proposal.experimentSummary!.treatmentIntegrity,
              ),
            ),
            const SizedBox(height: 4),
            _FactRow(
              label: 'Safety checks',
              value: _guardrailStatusLabel(
                proposal.experimentSummary!.guardrailStatus,
              ),
            ),
            if (testedBaseline != null) ...[
              const SizedBox(height: 4),
              _FactRow(label: 'Tested baseline', value: testedBaseline),
            ],
            if (testedCandidate != null) ...[
              const SizedBox(height: 4),
              _FactRow(label: 'Tested candidate', value: testedCandidate),
            ],
            if (proposal.experimentSummary!.terminalReason != null) ...[
              const SizedBox(height: 4),
              _FactRow(
                label: 'Why it stopped',
                value: proposal.experimentSummary!.terminalReason!,
              ),
            ],
          ],
          const SizedBox(height: 14),
          if (canRevert)
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                key: ValueKey('revert-proposal-${proposal.id}'),
                onPressed: pending ? null : onRevert,
                style: OutlinedButton.styleFrom(
                  foregroundColor: context.rhythm.danger,
                  side: BorderSide(color: context.rhythm.border),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(RhythmRadius.sm),
                  ),
                ),
                child: pending
                    ? const SizedBox(
                        height: 16,
                        width: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Undo this change'),
              ),
            )
          else
            Container(
              key: ValueKey('revert-blocked-${proposal.id}'),
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: context.rhythm.surfaceMuted,
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                border: Border.all(color: context.rhythm.border),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.build_outlined,
                    size: 15,
                    color: context.rhythm.textMuted,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      proposal.status == 'active'
                          ? "This change can't be undone from here. Rhythm "
                              "didn't keep a precise enough record of the "
                              'earlier settings, so someone on the tech team '
                              'has to put them back by hand.'
                          : "This change can't be undone from here until it "
                              'has finished settling in.',
                      style: TextStyle(
                        fontSize: 12,
                        color: context.rhythm.textSecondary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _FactRow extends StatelessWidget {
  const _FactRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 104,
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: context.rhythm.textMuted,
            ),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: context.rhythm.textPrimary,
            ),
          ),
        ),
      ],
    );
  }
}

/// C6-3 — a refine-config proposal whose experiment already promoted a
/// candidate, but whose live target drifted again before a human approved
/// it. Shown only on the pre-apply review card ([_ProposalCard]):
/// [OrgProposal.experimentSummary]'s `staleBeforeApplyConflict` is only ever
/// true while the proposal is still `proposed`/`approved`/`failed` — once
/// applied, "before it can be applied" no longer applies, so this banner is
/// never shown on [_AppliedCard].
class _StaleConflictBanner extends StatelessWidget {
  const _StaleConflictBanner({required this.proposalId});

  final String proposalId;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: ValueKey('stale-conflict-$proposalId'),
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: context.rhythm.warning.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        border: Border.all(color: context.rhythm.warning),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.warning_amber_outlined,
            size: 15,
            color: context.rhythm.warning,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'This was tested, but the settings changed again since then '
              '— it needs to be tested again before it can be trusted.',
              style:
                  TextStyle(fontSize: 12, color: context.rhythm.textSecondary),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Proposal card
// ---------------------------------------------------------------------------

class _ProposalCard extends StatefulWidget {
  const _ProposalCard({
    super.key,
    required this.proposal,
    required this.pending,
    required this.onApprove,
    required this.onReject,
  });

  final OrgProposal proposal;
  final bool pending;
  final VoidCallback onApprove;
  final VoidCallback onReject;

  @override
  State<_ProposalCard> createState() => _ProposalCardState();
}

class _ProposalCardState extends State<_ProposalCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final proposal = widget.proposal;
    final needsNote = proposal.requiresSecurityNote;
    final noteSatisfied = !needsNote || proposal.hasSecurityNote;
    final toolSafety = proposal.toolSafety;
    final toolApprovalAllowed = proposal.kind != 'tool-install' ||
        (proposal.status == 'sandbox-vetted' &&
            toolSafety?.isApprovalAllowed == true);
    final approveEnabled =
        !widget.pending && noteSatisfied && toolApprovalAllowed;

    return Container(
      decoration: BoxDecoration(
        color: context.rhythm.surface,
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        border: Border.all(color: context.rhythm.border),
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _KindBadge(kind: proposal.kind),
              const SizedBox(width: 8),
              _RiskBadge(risk: proposal.risk),
              const Spacer(),
              if (proposal.isExternal)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: context.rhythm.danger.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(RhythmRadius.pill),
                  ),
                  child: Text(
                    'EXTERNAL',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: context.rhythm.danger,
                      letterSpacing: 0.5,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            proposal.title,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: context.rhythm.textPrimary,
            ),
          ),
          if (proposal.rationale != null &&
              proposal.rationale!.trim().isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              proposal.rationale!,
              style: TextStyle(
                fontSize: 13,
                color: context.rhythm.textSecondary,
              ),
            ),
          ],
          const SizedBox(height: 12),
          if (proposal.kind == 'tool-install')
            _ToolSafetyCard(proposal: proposal)
          else
            _ProposalChangeBlock(proposal: proposal),
          if (needsNote) ...[
            const SizedBox(height: 12),
            _SecurityNoteBlock(proposal: proposal),
          ],
          if (proposal.experimentSummary?.staleBeforeApplyConflict ??
              false) ...[
            const SizedBox(height: 12),
            _StaleConflictBanner(proposalId: proposal.id),
          ],
          const SizedBox(height: 10),
          InkWell(
            key: ValueKey('proposal-evidence-toggle-${proposal.id}'),
            onTap: () => setState(() => _expanded = !_expanded),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  _expanded ? Icons.expand_less : Icons.expand_more,
                  size: 18,
                  color: context.rhythm.textMuted,
                ),
                const SizedBox(width: 4),
                Text(
                  _expanded ? 'Hide evidence' : 'Show evidence',
                  style: TextStyle(
                    fontSize: 13,
                    color: context.rhythm.textMuted,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          if (_expanded) ...[
            const SizedBox(height: 8),
            Container(
              key: ValueKey('proposal-evidence-body-${proposal.id}'),
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: context.rhythm.surfaceMuted,
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
              ),
              child: Text(
                proposal.signalRef?.trim().isNotEmpty == true
                    ? proposal.signalRef!
                    : 'No evidence recorded.',
                style: TextStyle(
                  fontSize: 12,
                  fontFamily: 'monospace',
                  color: context.rhythm.textSecondary,
                ),
              ),
            ),
          ],
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  key: ValueKey('reject-proposal-${proposal.id}'),
                  onPressed: widget.pending ? null : widget.onReject,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: context.rhythm.danger,
                    side: BorderSide(color: context.rhythm.border),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(RhythmRadius.sm),
                    ),
                  ),
                  child: const Text('Reject'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton(
                  key: ValueKey('approve-proposal-${proposal.id}'),
                  onPressed: approveEnabled ? widget.onApprove : null,
                  style: FilledButton.styleFrom(
                    backgroundColor: context.rhythm.accent,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(RhythmRadius.sm),
                    ),
                  ),
                  child: widget.pending
                      ? SizedBox(
                          height: 16,
                          width: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white.withValues(alpha: 0.8),
                          ),
                        )
                      : const Text('Approve'),
                ),
              ),
            ],
          ),
          if (needsNote && !noteSatisfied) ...[
            const SizedBox(height: 6),
            Text(
              'Approve is disabled until the note above is present.',
              style: TextStyle(fontSize: 11, color: context.rhythm.textMuted),
            ),
          ],
          if (proposal.kind == 'tool-install' && !toolApprovalAllowed) ...[
            const SizedBox(height: 6),
            Text(
              _toolApprovalBlockedReason(proposal),
              key: ValueKey('tool-safety-blocked-${proposal.id}'),
              style: TextStyle(fontSize: 11, color: context.rhythm.textMuted),
            ),
          ],
        ],
      ),
    );
  }
}

String _toolApprovalBlockedReason(OrgProposal proposal) {
  final safety = proposal.toolSafety;
  if (safety == null || safety.state == 'missing') {
    return 'Approval is blocked: the durable safety report is missing.';
  }
  if (safety.state == 'malformed') {
    return 'Approval is blocked: the safety report could not be verified.';
  }
  if (safety.verdict == 'unsafe') {
    return 'Approval is blocked: the sandbox marked this tool unsafe.';
  }
  if (safety.verdict == 'unknown') {
    return 'Approval is blocked: the sandbox could not reach a safe verdict.';
  }
  return 'Approval is blocked until sandbox vetting is complete.';
}

class _ToolSafetyCard extends StatelessWidget {
  const _ToolSafetyCard({required this.proposal});

  final OrgProposal proposal;

  @override
  Widget build(BuildContext context) {
    final safety = proposal.toolSafety;
    if (safety == null || !safety.isReady) {
      return Container(
        key: ValueKey('tool-safety-card-${proposal.id}'),
        width: double.infinity,
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: context.rhythm.surfaceMuted,
          borderRadius: BorderRadius.circular(RhythmRadius.sm),
          border: Border.all(color: context.rhythm.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Tool safety'),
            const SizedBox(height: 6),
            Semantics(
              key: ValueKey('tool-safety-verdict-${proposal.id}'),
              label: 'Tool safety verdict: Unknown — report unavailable',
              child: const Row(
                children: [
                  Icon(Icons.help_outline, size: 16),
                  SizedBox(width: 6),
                  Text('Unknown — report unavailable'),
                ],
              ),
            ),
            const SizedBox(height: 6),
            Text(
              _toolApprovalBlockedReason(proposal),
              style:
                  TextStyle(fontSize: 12, color: context.rhythm.textSecondary),
            ),
          ],
        ),
      );
    }
    final verdictLabel = switch (safety.verdict) {
      'safe' => 'Safe',
      'conditional' => 'Conditional — confirmation required',
      'unsafe' => 'Unsafe',
      _ => 'Unknown',
    };
    final verdictIcon = switch (safety.verdict) {
      'safe' => Icons.verified_outlined,
      'conditional' => Icons.warning_amber_outlined,
      'unsafe' => Icons.dangerous_outlined,
      _ => Icons.help_outline,
    };
    final verdictColor = switch (safety.verdict) {
      'safe' => context.rhythm.success,
      'conditional' => context.rhythm.warning,
      'unsafe' => context.rhythm.danger,
      _ => context.rhythm.textMuted,
    };
    return Container(
      key: ValueKey('tool-safety-card-${proposal.id}'),
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        border: Border.all(color: context.rhythm.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Tool safety',
              style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: context.rhythm.textPrimary)),
          const SizedBox(height: 8),
          Semantics(
            key: ValueKey('tool-safety-verdict-${proposal.id}'),
            label: 'Tool safety verdict: $verdictLabel',
            child: Row(children: [
              Icon(verdictIcon, size: 16, color: verdictColor),
              const SizedBox(width: 6),
              Text(verdictLabel,
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: verdictColor)),
            ]),
          ),
          const SizedBox(height: 8),
          _FactRow(label: 'Tool', value: safety.toolName!),
          const SizedBox(height: 4),
          _FactRow(label: 'Package', value: safety.packageSource!),
          const SizedBox(height: 4),
          _FactRow(
              label: 'Forbidden paths',
              value: _counts(safety.forbiddenPathViolations)),
          const SizedBox(height: 4),
          _FactRow(label: 'Network calls', value: _counts(safety.networkCalls)),
          const SizedBox(height: 4),
          _FactRow(
              label: 'Workspace writes',
              value: '${safety.workspaceWriteCount}'),
          const SizedBox(height: 4),
          _FactRow(
              label: 'Credential attempts',
              value: '${safety.credentialAccessAttemptsCount}'),
          const SizedBox(height: 4),
          _FactRow(
              label: 'Scenarios',
              value:
                  '${safety.scenarioAttemptsCount} in ${safety.sandboxDurationMs} ms'),
          if (safety.reason != null) ...[
            const SizedBox(height: 4),
            _FactRow(label: 'Reason', value: safety.reason!),
          ],
        ],
      ),
    );
  }

  String _counts(List<ToolSafetyCount> counts) => counts.isEmpty
      ? 'None observed'
      : counts.map((entry) => '${entry.name}: ${entry.count}').join(', ');
}

// ---------------------------------------------------------------------------
// Proposed change diff
// ---------------------------------------------------------------------------

class _ProposalChangeBlock extends StatelessWidget {
  const _ProposalChangeBlock({required this.proposal});

  final OrgProposal proposal;

  @override
  Widget build(BuildContext context) {
    // #1013: LLM-diagnosis proposals (the kinds that actually reach this queue)
    // carry a prose diagnosis, not a structured patch — render those fields
    // readably instead of generic "Before: (none) / After: <prose>" rows.
    final diagnosis = _diagnosisRows();
    final changes = diagnosis == null ? _fieldChanges() : null;
    return Container(
      key: ValueKey('proposal-change-body-${proposal.id}'),
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        border: Border.all(color: context.rhythm.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Proposed change',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: context.rhythm.textPrimary,
            ),
          ),
          const SizedBox(height: 8),
          if (diagnosis != null)
            ...diagnosis.expand(
              (row) => [
                Text(
                  row.key,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: context.rhythm.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  row.value,
                  style: TextStyle(
                    fontSize: 12,
                    color: row.key == 'Proposed fix'
                        ? context.rhythm.accent
                        : context.rhythm.textSecondary,
                    fontWeight: row.key == 'Proposed fix'
                        ? FontWeight.w600
                        : FontWeight.w400,
                  ),
                ),
                const SizedBox(height: 8),
              ],
            )
          else if (changes != null)
            ...changes.expand(
              (change) => [
                Text(
                  _fieldLabel(change.field),
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: context.rhythm.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Before: ${_displayValue(change.before)}',
                  style: TextStyle(
                    fontSize: 12,
                    color: context.rhythm.textSecondary,
                  ),
                ),
                Text(
                  'After: ${_displayValue(change.after)}',
                  style: TextStyle(
                    fontSize: 12,
                    color: context.rhythm.accent,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 8),
              ],
            )
          else
            Text(
              _prettyChangeJson(),
              style: TextStyle(
                fontSize: 12,
                fontFamily: 'monospace',
                color: context.rhythm.textSecondary,
              ),
            ),
        ],
      ),
    );
  }

  /// #1013: The proposals that actually reach this human-gated queue
  /// (refine-config / refine-scope / grant-delegation, from the #982 LLM
  /// diagnosis) carry a prose payload — `rootCause` / `concreteFix` /
  /// `diagnosis` — with no `configPatch`/`scopePatch` and no `beforeSnapshot`,
  /// so a before/after diff is meaningless. Surface the reviewer-relevant
  /// fields directly. Returns null when the proposal instead carries a
  /// structured patch (handled by [_fieldChanges]) or isn't a diagnosis shape.
  List<MapEntry<String, String>>? _diagnosisRows() {
    final change = proposal.change;
    if (change == null) return null;
    final isDiagnosis = change['source'] == 'org-optimizer-llm-diagnosis' ||
        change.containsKey('rootCause') ||
        change.containsKey('concreteFix') ||
        change.containsKey('diagnosis');
    if (!isDiagnosis) return null;
    // A structured patch, if present, is the concrete change — prefer it.
    if (_mapValue(change['configPatch']) != null ||
        _mapValue(change['scopePatch']) != null) {
      return null;
    }
    final rows = <MapEntry<String, String>>[];
    void add(String label, Object? value) {
      if (value == null) return;
      final s = _displayValue(value).trim();
      if (s.isEmpty || s == 'Not set' || s == 'Empty') return;
      rows.add(MapEntry(label, s));
    }

    add('Affected', change['affectedSkill']);
    add('Root cause', change['rootCause']);
    add('Proposed fix', change['concreteFix']);
    add('Fix type', change['fixType']);
    add('Diagnosis', change['diagnosis']);
    add('Confidence', change['confidence']);
    return rows.isEmpty ? null : rows;
  }

  List<_FieldChange>? _fieldChanges() {
    final change = proposal.change;
    if (change == null) return null;
    final before = proposal.beforeSnapshot;

    final configPatch = _mapValue(change['configPatch']);
    if (configPatch != null &&
        configPatch['field'] is String &&
        configPatch.containsKey('value')) {
      return [
        _FieldChange(
          configPatch['field'] as String,
          before?['priorValue'],
          configPatch['value'],
        ),
      ];
    }

    final scopePatch = _mapValue(change['scopePatch']);
    if (scopePatch != null && scopePatch['field'] is String) {
      final priorValue = before?['priorValue'];
      final priorItems = _stringList(priorValue);
      final remove = _stringList(scopePatch['remove']);
      final afterItems =
          priorItems.where((item) => !remove.contains(item)).toList();
      for (final item in _stringList(scopePatch['add'])) {
        if (!afterItems.contains(item)) afterItems.add(item);
      }
      return [
        _FieldChange(scopePatch['field'] as String, priorValue, afterItems),
      ];
    }

    final directChanges = change.entries
        .where((entry) => entry.key != 'agentConfigId' && entry.value is! Map)
        .map(
          (entry) => _FieldChange(entry.key, before?[entry.key], entry.value),
        )
        .toList();
    return directChanges.isEmpty ? null : directChanges;
  }

  String _prettyChangeJson() {
    final change = proposal.change;
    if (change != null) {
      return const JsonEncoder.withIndent('  ').convert(change);
    }
    final raw = proposal.changeJson?.trim();
    return raw == null || raw.isEmpty ? 'No proposed change recorded.' : raw;
  }

  static Map<String, dynamic>? _mapValue(Object? value) =>
      value is Map<String, dynamic> ? value : null;

  static List<String> _stringList(Object? value) {
    if (value is List) return value.whereType<String>().toList();
    if (value is String) {
      try {
        final decoded = jsonDecode(value);
        if (decoded is List) return decoded.whereType<String>().toList();
      } catch (_) {
        // A non-JSON prior value is still rendered directly in the diff.
      }
    }
    return const [];
  }

  static String _fieldLabel(String field) {
    const labels = {
      'allowedMcpsJson': 'Allowed MCPs',
      'allowedSkillsJson': 'Allowed skills',
      'allowedDelegatesJson': 'Allowed delegates',
      'agentSlug': 'Agent slug',
      'system_prompt': 'System prompt',
      'targetRecipeId': 'Target recipe',
      'targetScheduledTaskId': 'Target scheduled task',
    };
    return labels[field] ??
        field
            .replaceAllMapped(
              RegExp(r'([a-z])([A-Z])'),
              (match) => '${match[1]} ${match[2]}',
            )
            .replaceAll('_', ' ')
            .replaceFirstMapped(
              RegExp(r'^.'),
              (match) => match[0]!.toUpperCase(),
            );
  }

  static String _displayValue(Object? value) {
    if (value == null) return 'Not set';
    if (value is String) {
      try {
        return _displayValue(jsonDecode(value));
      } catch (_) {
        return value.isEmpty ? 'Empty' : value;
      }
    }
    if (value is List) {
      return value.isEmpty ? 'None' : value.map(_displayValue).join(', ');
    }
    if (value is Map) return const JsonEncoder.withIndent('  ').convert(value);
    return value.toString();
  }
}

class _FieldChange {
  const _FieldChange(this.field, this.before, this.after);

  final String field;
  final Object? before;
  final Object? after;
}

// ---------------------------------------------------------------------------
// Security / provenance note block
// ---------------------------------------------------------------------------

class _SecurityNoteBlock extends StatelessWidget {
  const _SecurityNoteBlock({required this.proposal});

  final OrgProposal proposal;

  @override
  Widget build(BuildContext context) {
    final note = proposal.provenance;
    final isExternalAdoption = proposal.kind == 'external-adoption';

    return Container(
      key: ValueKey('proposal-security-note-${proposal.id}'),
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: note == null
            ? context.rhythm.danger.withValues(alpha: 0.08)
            : context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        border: Border.all(
          color: note == null
              ? context.rhythm.danger.withValues(alpha: 0.4)
              : context.rhythm.border,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                isExternalAdoption ? Icons.travel_explore : Icons.security,
                size: 15,
                color: note == null
                    ? context.rhythm.danger
                    : context.rhythm.textSecondary,
              ),
              const SizedBox(width: 6),
              Text(
                isExternalAdoption ? 'Provenance' : 'Security note',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: note == null
                      ? context.rhythm.danger
                      : context.rhythm.textSecondary,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          if (note == null)
            Text(
              isExternalAdoption
                  ? 'Missing provenance (source, stars/downloads, last-updated, maintainer, license, install command).'
                  : 'Missing security note (trigger source/event, target agent/recipe + scope, HMAC setup, SSRF/allowlist, fencing confirmation).',
              style: TextStyle(fontSize: 12, color: context.rhythm.danger),
            )
          else
            ...note.entries.map(
              (entry) => Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Text(
                  '${entry.key}: ${entry.value}',
                  style: TextStyle(
                    fontSize: 12,
                    color: context.rhythm.textPrimary,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

class _KindBadge extends StatelessWidget {
  const _KindBadge({required this.kind});

  final String kind;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: context.rhythm.accentMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.pill),
      ),
      child: Text(
        kind,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: context.rhythm.accent,
        ),
      ),
    );
  }
}

class _RiskBadge extends StatelessWidget {
  const _RiskBadge({required this.risk});

  final String risk;

  @override
  Widget build(BuildContext context) {
    final isHigh = risk == 'high';
    final color = isHigh ? context.rhythm.danger : context.rhythm.success;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(RhythmRadius.pill),
      ),
      child: Text(
        risk.toUpperCase(),
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: color,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}
