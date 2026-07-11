import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/session_history_controller.dart';
import '../models/session_history_agent_session.dart';
import '../models/session_transcript_message.dart';

class SessionHistoryView extends StatefulWidget {
  const SessionHistoryView({super.key});

  @override
  State<SessionHistoryView> createState() => _SessionHistoryViewState();
}

class _SessionHistoryViewState extends State<SessionHistoryView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<SessionHistoryController>().refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<SessionHistoryController>(
      builder: (context, controller, _) {
        final colorScheme = Theme.of(context).colorScheme;
        return Scaffold(
          backgroundColor: context.rhythm.canvas,
          appBar: AppBar(
            backgroundColor: context.rhythm.surface,
            title: Text(
              'Session History',
              style: TextStyle(color: colorScheme.onSurface),
            ),
            actions: [
              IconButton(
                tooltip: 'Refresh',
                onPressed:
                    controller.status == SessionHistoryControllerStatus.loading
                        ? null
                        : controller.refresh,
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
          body: _SessionHistoryBody(controller: controller),
        );
      },
    );
  }
}

class _SessionHistoryBody extends StatelessWidget {
  const _SessionHistoryBody({required this.controller});

  final SessionHistoryController controller;

  @override
  Widget build(BuildContext context) {
    if (controller.status == SessionHistoryControllerStatus.loading &&
        controller.sessions.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (controller.status == SessionHistoryControllerStatus.error &&
        controller.sessions.isEmpty) {
      return _CenteredState(
        icon: Icons.error_outline,
        title: 'Could not load session history',
        subtitle: controller.error ?? 'Unknown error',
      );
    }

    if (controller.sessions.isEmpty) {
      return const _CenteredState(
        icon: Icons.history,
        title: 'No background sessions yet',
        subtitle: 'Cookbook recipe and scheduled task runs will appear here.',
      );
    }

    return RefreshIndicator(
      onRefresh: controller.refresh,
      child: ListView.separated(
        padding: const EdgeInsets.all(RhythmSpacing.md),
        itemCount: controller.sessions.length,
        separatorBuilder: (_, __) => const SizedBox(height: RhythmSpacing.xs),
        itemBuilder: (context, index) {
          final session = controller.sessions[index];
          return _SessionHistoryTile(
            session: session,
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => _SessionTranscriptView(session: session),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class _SessionHistoryTile extends StatelessWidget {
  const _SessionHistoryTile({required this.session, required this.onTap});

  final SessionHistoryAgentSession session;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Material(
      color: context.rhythm.surfaceRaised,
      borderRadius: BorderRadius.circular(RhythmRadius.lg),
      child: InkWell(
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(RhythmSpacing.md),
          decoration: BoxDecoration(
            border: Border.all(color: context.rhythm.borderSubtle),
            borderRadius: BorderRadius.circular(RhythmRadius.lg),
          ),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: colorScheme.primary.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(RhythmRadius.md),
                ),
                child: Icon(
                  session.source == SessionHistorySource.scheduledTask
                      ? Icons.schedule
                      : Icons.menu_book_outlined,
                  color: colorScheme.primary,
                ),
              ),
              const SizedBox(width: RhythmSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      session.agentOrRecipeName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: context.rhythm.textPrimary,
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${_formatDateTime(session.startTime)} - ${session.id}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: context.rhythm.textMuted,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: RhythmSpacing.md),
              _StatusChip(status: session.status),
              const SizedBox(width: RhythmSpacing.sm),
              Icon(Icons.chevron_right, color: context.rhythm.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

class _SessionTranscriptView extends StatefulWidget {
  const _SessionTranscriptView({required this.session});

  final SessionHistoryAgentSession session;

  @override
  State<_SessionTranscriptView> createState() => _SessionTranscriptViewState();
}

class _SessionTranscriptViewState extends State<_SessionTranscriptView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<SessionHistoryController>().loadTranscript(
            widget.session.id,
          );
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<SessionHistoryController>(
      builder: (context, controller, _) {
        final messages = controller.transcriptFor(widget.session.id);
        return Scaffold(
          backgroundColor: context.rhythm.canvas,
          appBar: AppBar(
            backgroundColor: context.rhythm.surface,
            title: Text(
              widget.session.agentOrRecipeName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: context.rhythm.textPrimary),
            ),
          ),
          body: _TranscriptBody(
            status: controller.status,
            error: controller.error,
            messages: messages,
            session: widget.session,
          ),
        );
      },
    );
  }
}

class _TranscriptBody extends StatelessWidget {
  const _TranscriptBody({
    required this.status,
    required this.error,
    required this.messages,
    required this.session,
  });

  final SessionHistoryControllerStatus status;
  final String? error;
  final List<SessionTranscriptMessage> messages;
  final SessionHistoryAgentSession session;

  @override
  Widget build(BuildContext context) {
    if (status == SessionHistoryControllerStatus.loading && messages.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (status == SessionHistoryControllerStatus.error && messages.isEmpty) {
      return _CenteredState(
        icon: Icons.error_outline,
        title: 'Could not load transcript',
        subtitle: error ?? 'Unknown error',
      );
    }
    if (messages.isEmpty) {
      if (session.status == SessionHistoryStatus.failed) {
        return _CenteredState(
          icon: Icons.error_outline,
          title: 'No transcript — run was interrupted or errored',
          subtitle:
              session.statusMessage ?? 'No further details were recorded.',
        );
      }
      return const _CenteredState(
        icon: Icons.notes_outlined,
        title: 'No transcript messages',
        subtitle: 'This run has not written any transcript rows yet.',
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(RhythmSpacing.md),
      itemCount: messages.length +
          (session.status == SessionHistoryStatus.failed ? 1 : 0),
      separatorBuilder: (_, __) => const SizedBox(height: RhythmSpacing.sm),
      itemBuilder: (context, index) {
        if (index == messages.length) {
          return _TranscriptErrorCard(message: session.statusMessage);
        }
        return _TranscriptMessageCard(message: messages[index]);
      },
    );
  }
}

class _TranscriptErrorCard extends StatelessWidget {
  const _TranscriptErrorCard({required this.message});

  final String? message;

  @override
  Widget build(BuildContext context) {
    final color = context.rhythm.danger;
    return Container(
      padding: const EdgeInsets.all(RhythmSpacing.md),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_outline, color: color),
          const SizedBox(width: RhythmSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Run interrupted or errored',
                  style: TextStyle(
                    color: color,
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: RhythmSpacing.xs),
                Text(
                  message ?? 'No further details were recorded.',
                  style: TextStyle(
                    color: context.rhythm.textSecondary,
                    fontSize: 13,
                    height: 1.45,
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

class _TranscriptMessageCard extends StatelessWidget {
  const _TranscriptMessageCard({required this.message});

  final SessionTranscriptMessage message;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(RhythmSpacing.md),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised,
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        border: Border.all(color: context.rhythm.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                message.roleLabel,
                style: TextStyle(
                  color: colorScheme.primary,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const Spacer(),
              Text(
                _formatDateTime(message.createdAt),
                style: TextStyle(color: context.rhythm.textMuted, fontSize: 12),
              ),
            ],
          ),
          const SizedBox(height: RhythmSpacing.sm),
          SelectableText(
            message.text.isEmpty ? '(empty message)' : message.text,
            style: TextStyle(
              color: context.rhythm.textPrimary,
              fontSize: 13,
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});

  final SessionHistoryStatus status;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      SessionHistoryStatus.running => Theme.of(context).colorScheme.primary,
      SessionHistoryStatus.completed => context.rhythm.success,
      SessionHistoryStatus.failed => context.rhythm.danger,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.20)),
      ),
      child: Text(
        status.label,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _CenteredState extends StatelessWidget {
  const _CenteredState({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(RhythmSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 42, color: context.rhythm.textMuted),
            const SizedBox(height: RhythmSpacing.md),
            Text(
              title,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: context.rhythm.textPrimary,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: RhythmSpacing.xs),
            Text(
              subtitle,
              textAlign: TextAlign.center,
              style: TextStyle(color: context.rhythm.textMuted, fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }
}

String _formatDateTime(DateTime value) {
  final local = value.toLocal();
  final month = local.month.toString().padLeft(2, '0');
  final day = local.day.toString().padLeft(2, '0');
  final hour = local.hour.toString().padLeft(2, '0');
  final minute = local.minute.toString().padLeft(2, '0');
  return '${local.year}-$month-$day $hour:$minute';
}
