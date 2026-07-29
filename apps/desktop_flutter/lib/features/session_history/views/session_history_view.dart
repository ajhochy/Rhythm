import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../../app/core/utils/time_format.dart';
import '../controllers/session_history_controller.dart';
import '../models/session_history_agent_session.dart';
import '../models/session_transcript_message.dart';

/// #1027 (USO A4) — the standalone Session History LIST page was retired; the
/// unified Agents list + `?scope=` server filter replaces it. This transcript
/// DETAIL view survives and is reused by the Agents session detail for ANY
/// session (chat / scheduled / self_improvement). #999 (tool-parts rendering)
/// and #1006 (errored-empty-state) behaviour are preserved unchanged.
class SessionTranscriptView extends StatefulWidget {
  const SessionTranscriptView({
    super.key,
    required this.sessionId,
    required this.title,
    required this.status,
    this.statusMessage,
  });

  final String sessionId;
  final String title;
  final SessionHistoryStatus status;
  final String? statusMessage;

  @override
  State<SessionTranscriptView> createState() => _SessionTranscriptViewState();
}

class _SessionTranscriptViewState extends State<SessionTranscriptView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<SessionHistoryController>().loadTranscript(widget.sessionId);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<SessionHistoryController>(
      builder: (context, controller, _) {
        final messages = controller.transcriptFor(widget.sessionId);
        return Scaffold(
          backgroundColor: context.rhythm.canvas,
          appBar: AppBar(
            backgroundColor: context.rhythm.surface,
            title: Text(
              widget.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: context.rhythm.textPrimary),
            ),
          ),
          body: _TranscriptBody(
            status: controller.status,
            error: controller.error,
            messages: messages,
            sessionStatus: widget.status,
            statusMessage: widget.statusMessage,
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
    required this.sessionStatus,
    required this.statusMessage,
  });

  final SessionHistoryControllerStatus status;
  final String? error;
  final List<SessionTranscriptMessage> messages;
  final SessionHistoryStatus sessionStatus;
  final String? statusMessage;

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
      if (sessionStatus == SessionHistoryStatus.failed) {
        return _CenteredState(
          icon: Icons.error_outline,
          title: 'No transcript — run was interrupted or errored',
          subtitle: statusMessage ?? 'No further details were recorded.',
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
      itemCount:
          messages.length +
          (sessionStatus == SessionHistoryStatus.failed ? 1 : 0),
      separatorBuilder: (_, __) => const SizedBox(height: RhythmSpacing.sm),
      itemBuilder: (context, index) {
        if (index == messages.length) {
          return _TranscriptErrorCard(message: statusMessage);
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
  return formatLocalTimestamp(value);
}
