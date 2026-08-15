import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../notifications/controllers/agent_approvals_controller.dart';
import '../../notifications/models/agent_approval.dart';

/// An actionable approval request composed into its originating transcript.
///
/// Decisions intentionally go through the same controller as the bell panel,
/// preserving the signed human-decision flow and removing the card from both
/// surfaces after a successful response.
class InlineAgentApprovalCard extends StatefulWidget {
  const InlineAgentApprovalCard({
    super.key,
    required this.approval,
    this.focused = false,
  });

  final AgentApproval approval;
  final bool focused;

  @override
  State<InlineAgentApprovalCard> createState() =>
      _InlineAgentApprovalCardState();
}

class _InlineAgentApprovalCardState extends State<InlineAgentApprovalCard> {
  bool _revealScheduled = false;

  AgentApproval get approval => widget.approval;

  @override
  void initState() {
    super.initState();
    _scheduleRevealIfFocused();
  }

  @override
  void didUpdateWidget(covariant InlineAgentApprovalCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!oldWidget.focused && widget.focused) {
      _revealScheduled = false;
      _scheduleRevealIfFocused();
    }
  }

  void _scheduleRevealIfFocused() {
    if (!widget.focused || _revealScheduled) return;
    _revealScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      await Scrollable.ensureVisible(
        context,
        alignment: .5,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
      if (!mounted) return;
      context.read<AgentApprovalsController>().clearFocusedApproval();
    });
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.read<AgentApprovalsController>();

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised,
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        border: Border.all(
          color: context.rhythm.warning.withValues(
            alpha: widget.focused ? 1 : .5,
          ),
          width: widget.focused ? 2 : 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                Icons.pending_actions_outlined,
                size: 18,
                color: context.rhythm.warning,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Approval requested',
                      style: TextStyle(
                        color: context.rhythm.warning,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      approval.action,
                      style: TextStyle(
                        color: context.rhythm.textPrimary,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (approval.preview?.isNotEmpty ?? false) ...[
                      const SizedBox(height: 5),
                      Text(
                        approval.preview!,
                        style: TextStyle(
                          color: context.rhythm.textSecondary,
                          fontSize: 12,
                        ),
                      ),
                    ],
                    if (approval.consequence?.isNotEmpty ?? false) ...[
                      const SizedBox(height: 4),
                      Text(
                        approval.consequence!,
                        style: TextStyle(
                          color: context.rhythm.textMuted,
                          fontSize: 11,
                          fontStyle: FontStyle.italic,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              TextButton(
                onPressed: () => controller.reject(approval.id),
                style: TextButton.styleFrom(
                  foregroundColor: context.rhythm.danger,
                ),
                child: const Text('Reject'),
              ),
              const SizedBox(width: 6),
              TextButton(
                onPressed: () => controller.approve(approval.id),
                style: TextButton.styleFrom(
                  foregroundColor: context.rhythm.accent,
                ),
                child: const Text('Approve'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
