import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../../app/core/utils/time_format.dart';
import '../../agents/controllers/agents_controller.dart';
import '../controllers/agent_email_controller.dart';
import '../models/gmail_signal.dart';

class AgentEmailView extends StatefulWidget {
  const AgentEmailView({super.key});

  @override
  State<AgentEmailView> createState() => _AgentEmailViewState();
}

class _AgentEmailViewState extends State<AgentEmailView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AgentEmailController>().loadSignals();
    });
  }

  Future<void> _launchEmailAssistant(BuildContext context) async {
    final agentsController = context.read<AgentsController>();
    final session = await agentsController.createSession(
      cwd: '',
      name: 'Email Assistant',
      mcpRole: 'email-assistant',
    );
    if (!context.mounted) return;
    if (session == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(agentsController.error ?? 'Failed to create session.'),
        ),
      );
      return;
    }
    agentsController.selectSession(session.id);
    agentsController.setComposerDraft(
      session.id,
      'Review my recent unread email and summarize what needs a reply.',
    );
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<AgentEmailController>(
      builder: (context, controller, _) {
        return Scaffold(
          backgroundColor: context.rhythm.canvas,
          appBar: AppBar(
            backgroundColor: context.rhythm.surface,
            elevation: 0,
            title: Text(
              'Email',
              style: TextStyle(
                color: context.rhythm.textPrimary,
                fontWeight: FontWeight.w600,
                fontSize: 18,
              ),
            ),
            actions: [
              if (controller.status == AgentEmailStatus.idle)
                IconButton(
                  icon: Icon(
                    Icons.refresh_rounded,
                    color: context.rhythm.textSecondary,
                  ),
                  tooltip: 'Refresh',
                  onPressed: () => controller.loadSignals(),
                ),
            ],
          ),
          body: Column(
            children: [
              // Launch button always visible at the top.
              Padding(
                padding: const EdgeInsets.all(RhythmSpacing.md),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    key: const ValueKey('launch-email-assistant-btn'),
                    onPressed: () => _launchEmailAssistant(context),
                    icon: const Icon(Icons.email_outlined, size: 18),
                    label: const Text('Launch email assistant'),
                    style: FilledButton.styleFrom(
                      backgroundColor: context.rhythm.accent,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(
                        vertical: RhythmSpacing.sm,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(RhythmRadius.md),
                      ),
                    ),
                  ),
                ),
              ),
              Divider(height: 1, color: context.rhythm.borderSubtle),
              Expanded(child: _buildBody(context, controller)),
            ],
          ),
        );
      },
    );
  }

  Widget _buildBody(BuildContext context, AgentEmailController controller) {
    if (controller.status == AgentEmailStatus.loading &&
        controller.signals.isEmpty) {
      return Center(
        child: CircularProgressIndicator(color: context.rhythm.accent),
      );
    }

    if (controller.signals.isEmpty) {
      return Center(
        key: const ValueKey('email-empty-state'),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.mark_email_unread_outlined,
              color: context.rhythm.textMuted,
              size: 56,
            ),
            const SizedBox(height: RhythmSpacing.md),
            Text(
              'No recent email signals',
              style: TextStyle(
                color: context.rhythm.textSecondary,
                fontSize: 16,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: RhythmSpacing.xs),
            Text(
              'Gmail signals will appear here once synced',
              style: TextStyle(color: context.rhythm.textMuted, fontSize: 13),
            ),
          ],
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(RhythmSpacing.md),
      itemCount: controller.signals.length,
      separatorBuilder: (_, __) => const SizedBox(height: RhythmSpacing.xs),
      itemBuilder: (context, index) {
        final signal = controller.signals[index];
        return _SignalTile(signal: signal);
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Signal tile
// ---------------------------------------------------------------------------

class _SignalTile extends StatelessWidget {
  const _SignalTile({required this.signal});

  final AgentEmailGmailSignal signal;

  String _formatReceivedAt(String? raw) {
    if (raw == null || raw.isEmpty) return '';
    return formatLocalTimestamp(raw);
  }

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;

    return Container(
      decoration: BoxDecoration(
        color: rhythm.surfaceRaised,
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        border: Border.all(
          color: signal.isUnread
              ? rhythm.accent.withValues(alpha: 0.4)
              : rhythm.borderSubtle,
        ),
        boxShadow: RhythmElevation.panel,
      ),
      padding: const EdgeInsets.all(RhythmSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Unread indicator dot.
          Container(
            width: 8,
            height: 8,
            margin: const EdgeInsets.only(top: 4, right: RhythmSpacing.sm),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: signal.isUnread ? rhythm.accent : Colors.transparent,
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        signal.fromName.isNotEmpty
                            ? signal.fromName
                            : signal.fromEmail,
                        style: TextStyle(
                          color: rhythm.textPrimary,
                          fontWeight: signal.isUnread
                              ? FontWeight.w700
                              : FontWeight.w500,
                          fontSize: 13,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (signal.receivedAt != null)
                      Text(
                        _formatReceivedAt(signal.receivedAt),
                        style: TextStyle(color: rhythm.textMuted, fontSize: 11),
                      ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  signal.subject,
                  style: TextStyle(
                    color: rhythm.textPrimary,
                    fontWeight:
                        signal.isUnread ? FontWeight.w600 : FontWeight.normal,
                    fontSize: 13,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
                if (signal.snippet != null && signal.snippet!.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    signal.snippet!,
                    style: TextStyle(color: rhythm.textMuted, fontSize: 12),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
