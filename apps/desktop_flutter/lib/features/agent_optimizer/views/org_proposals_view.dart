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
        return Scaffold(
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
                icon: Icon(Icons.refresh, color: context.rhythm.textSecondary),
                tooltip: 'Refresh',
                onPressed: controller.refresh,
              ),
              const SizedBox(width: 8),
            ],
            bottom: PreferredSize(
              preferredSize: const Size.fromHeight(1),
              child: Divider(
                height: 1,
                thickness: 1,
                color: context.rhythm.border,
              ),
            ),
          ),
          body: _buildBody(context, controller),
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
    final ok = await controller.approve(proposal.id);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          ok ? 'Proposal approved' : (controller.error ?? 'Approve failed'),
        ),
        backgroundColor: ok ? context.rhythm.success : context.rhythm.danger,
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 2),
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
    final approveEnabled = !widget.pending && noteSatisfied;

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
              style:
                  TextStyle(fontSize: 13, color: context.rhythm.textSecondary),
            ),
          ],
          if (needsNote) ...[
            const SizedBox(height: 12),
            _SecurityNoteBlock(proposal: proposal),
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
                    : (proposal.changeJson?.trim().isNotEmpty == true
                        ? proposal.changeJson!
                        : 'No evidence recorded.'),
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
        ],
      ),
    );
  }
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
