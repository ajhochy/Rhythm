import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/notifications_controller.dart';
import '../models/app_notification.dart';

class NotificationPanel extends StatelessWidget {
  const NotificationPanel({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<NotificationsController>();
    final notifications = controller.notifications;

    return Material(
      elevation: 8,
      color: context.rhythm.surfaceRaised,
      borderRadius: BorderRadius.circular(RhythmRadius.lg),
      child: Container(
        width: 320,
        constraints: const BoxConstraints(maxHeight: 480),
        decoration: BoxDecoration(
          color: context.rhythm.surfaceRaised,
          borderRadius: BorderRadius.circular(RhythmRadius.lg),
          border: Border.all(color: context.rhythm.borderSubtle),
          boxShadow: RhythmElevation.panel,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _PanelHeader(hasNotifications: notifications.isNotEmpty),
            if (notifications.isEmpty)
              const _EmptyState()
            else
              Flexible(
                child: ListView.separated(
                  padding: EdgeInsets.zero,
                  shrinkWrap: true,
                  itemCount: notifications.length,
                  separatorBuilder: (context, __) => Divider(
                    height: 1,
                    color: context.rhythm.borderSubtle,
                  ),
                  itemBuilder: (context, index) {
                    return _NotificationTile(
                      notification: notifications[index],
                    );
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _PanelHeader extends StatelessWidget {
  const _PanelHeader({required this.hasNotifications});

  final bool hasNotifications;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 8, 14),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: context.rhythm.borderSubtle),
        ),
      ),
      child: Row(
        children: [
          Text(
            'Notifications',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: context.rhythm.textPrimary,
            ),
          ),
          const Spacer(),
          if (hasNotifications)
            TextButton(
              onPressed: () =>
                  context.read<NotificationsController>().markAllRead(),
              style: TextButton.styleFrom(
                foregroundColor: context.rhythm.accent,
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                textStyle: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
              child: const Text('Mark all read'),
            ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 16),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.notifications_none,
              size: 32,
              color: context.rhythm.textMuted,
            ),
            const SizedBox(height: 8),
            Text(
              'You\u2019re all caught up',
              style: TextStyle(
                color: context.rhythm.textSecondary,
                fontSize: 13,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({required this.notification});

  final AppNotification notification;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () {
        context.read<NotificationsController>()
          ..markRead(notification.id)
          ..navigateTo(notification.entityType, notification.entityId);
        // Close the panel by removing the overlay (caller handles via Navigator pop).
        Navigator.of(context, rootNavigator: true).maybePop();
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Icon(
                _iconFor(notification.type),
                size: 16,
                color: context.rhythm.accent,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    notification.message,
                    style: TextStyle(
                      fontSize: 13,
                      color: context.rhythm.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    _relativeTime(notification.createdAt),
                    style: TextStyle(
                      fontSize: 11,
                      color: context.rhythm.textMuted,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  IconData _iconFor(String type) {
    switch (type) {
      case 'task_assigned':
        return Icons.assignment_ind_outlined;
      case 'collaborator_added':
        return Icons.group_add_outlined;
      case 'step_completed':
        return Icons.check_circle_outline;
      case 'step_due':
        return Icons.schedule_outlined;
      case 'rhythm_step_unlocked':
        return Icons.lock_open_outlined;
      default:
        return Icons.notifications_outlined;
    }
  }

  String _relativeTime(String iso) {
    try {
      final dt = DateTime.parse(iso).toLocal();
      final diff = DateTime.now().difference(dt);
      if (diff.inMinutes < 1) return 'just now';
      if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
      if (diff.inHours < 24) return '${diff.inHours}h ago';
      return '${diff.inDays}d ago';
    } catch (_) {
      return '';
    }
  }
}
