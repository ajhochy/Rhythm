import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../features/messages/controllers/messages_controller.dart';
import '../constants/app_constants.dart';
import '../ui/tokens/rhythm_theme.dart';

/// Workspace navigation displayed in the app-shell header.
class NavigationSidebar extends StatelessWidget {
  const NavigationSidebar({
    super.key,
    required this.selectedIndex,
    required this.collapsed,
    required this.onItemSelected,
  });

  final int selectedIndex;
  // Retained for callers during the sidebar-to-header migration.
  final bool collapsed;
  final ValueChanged<int> onItemSelected;

  static const _items = [
    _NavItem(AppConstants.navDashboard, 'Dashboard'),
    _NavItem(AppConstants.navWeeklyPlanner, 'Planner', 'Weekly Planner'),
    _NavItem(AppConstants.navTasks, 'Tasks'),
    _NavItem(AppConstants.navRhythms, 'Rhythms'),
    _NavItem(AppConstants.navProjects, 'Projects'),
    _NavItem(AppConstants.navMessages, 'Messages'),
    _NavItem(AppConstants.navFacilities, 'Facilities'),
    _NavItem(AppConstants.navAutomations, 'Automations'),
    _NavItem(AppConstants.navIntegrations, 'Integrations'),
    _NavItem(AppConstants.navAgents, 'Agents'),
  ];

  static const _primaryIndices = [
    AppConstants.navDashboard,
    AppConstants.navWeeklyPlanner,
    AppConstants.navTasks,
    AppConstants.navRhythms,
    AppConstants.navProjects,
    AppConstants.navMessages,
    AppConstants.navAgents,
  ];

  @override
  Widget build(BuildContext context) {
    final unreadCount = context.watch<MessagesController>().totalUnreadCount;
    return LayoutBuilder(
      builder: (context, constraints) {
        final textScaler = MediaQuery.textScalerOf(context);
        double tabWidth(_NavItem item, {required bool selected}) {
          final painter = TextPainter(
            text: TextSpan(
              text: item.label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
            textDirection: TextDirection.ltr,
            textScaler: textScaler,
          )..layout();
          return painter.width +
              14 +
              (item.index == AppConstants.navMessages && unreadCount > 0
                  ? 12
                  : 0);
        }

        final totalWidth = _items.fold<double>(
          0,
          (width, item) =>
              width + tabWidth(item, selected: selectedIndex == item.index),
        );
        final visibleIndices = <int>{};
        if (totalWidth <= constraints.maxWidth) {
          visibleIndices.addAll(_items.map((item) => item.index));
        } else {
          const moreItem = _NavItem(-1, 'More');
          var usedWidth = tabWidth(moreItem, selected: false);
          for (final index in _primaryIndices) {
            final item = _items.firstWhere((item) => item.index == index);
            final width = tabWidth(item, selected: selectedIndex == item.index);
            if (usedWidth + width > constraints.maxWidth) break;
            usedWidth += width;
            visibleIndices.add(index);
          }
        }
        final items =
            _items.where((item) => visibleIndices.contains(item.index));
        final overflowItems =
            _items.where((item) => !visibleIndices.contains(item.index));
        return Row(
          key: const ValueKey('global-navigation-tabs'),
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final item in items)
              _WorkspaceTab(
                item: item,
                selected: selectedIndex == item.index,
                unreadCount:
                    item.index == AppConstants.navMessages ? unreadCount : null,
                onSelected: () => onItemSelected(item.index),
              ),
            if (overflowItems.isNotEmpty)
              _MoreMenu(
                selectedIndex: selectedIndex,
                overflowItems: overflowItems,
                onItemSelected: onItemSelected,
              ),
          ],
        );
      },
    );
  }
}

class _NavItem {
  const _NavItem(this.index, this.label, [this.semanticLabel]);

  final int index;
  final String label;
  final String? semanticLabel;
}

class _WorkspaceTab extends StatelessWidget {
  const _WorkspaceTab({
    required this.item,
    required this.selected,
    required this.unreadCount,
    required this.onSelected,
  });

  final _NavItem item;
  final bool selected;
  final int? unreadCount;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) => Tooltip(
        message: item.semanticLabel ?? item.label,
        child: Semantics(
          button: true,
          selected: selected,
          label: item.semanticLabel ?? item.label,
          child: TextButton(
            onPressed: onSelected,
            style: ButtonStyle(
              minimumSize: const WidgetStatePropertyAll(Size(0, 34)),
              padding: const WidgetStatePropertyAll(
                EdgeInsets.symmetric(horizontal: 7),
              ),
              foregroundColor: WidgetStatePropertyAll(
                selected
                    ? context.rhythm.textPrimary
                    : context.rhythm.textSecondary,
              ),
              backgroundColor: WidgetStateProperty.resolveWith(
                (states) => states.contains(WidgetState.hovered)
                    ? context.rhythm.accentMuted
                    : Colors.transparent,
              ),
              side: WidgetStateProperty.resolveWith(
                (states) => states.contains(WidgetState.focused)
                    ? BorderSide(color: context.rhythm.accent, width: 2)
                    : BorderSide.none,
              ),
              shape: WidgetStatePropertyAll(
                RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.md),
                ),
              ),
            ),
            child: Stack(
              children: [
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      item.label,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight:
                            selected ? FontWeight.w700 : FontWeight.w500,
                      ),
                    ),
                    if ((unreadCount ?? 0) > 0) ...[
                      const SizedBox(width: 4),
                      _UnreadBadge(count: unreadCount!),
                    ],
                  ],
                ),
                if (selected)
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 0,
                    child: Container(
                      key: const ValueKey('global-navigation-active-underline'),
                      height: 2,
                      color: context.rhythm.accent,
                    ),
                  ),
              ],
            ),
          ),
        ),
      );
}

class _MoreMenu extends StatelessWidget {
  const _MoreMenu({
    required this.selectedIndex,
    required this.overflowItems,
    required this.onItemSelected,
  });

  final int selectedIndex;
  final Iterable<_NavItem> overflowItems;
  final ValueChanged<int> onItemSelected;

  @override
  Widget build(BuildContext context) {
    final selected = overflowItems.any((item) => item.index == selectedIndex);
    return Semantics(
      button: true,
      selected: selected,
      label: 'More',
      child: PopupMenuButton<int>(
        tooltip: 'More',
        onSelected: onItemSelected,
        itemBuilder: (context) => [
          for (final item in overflowItems)
            PopupMenuItem(
              value: item.index,
              child: Semantics(
                selected: selectedIndex == item.index,
                child: Text(item.label),
              ),
            ),
        ],
        child: _MoreButton(selected: selected),
      ),
    );
  }
}

class _MoreButton extends StatelessWidget {
  const _MoreButton({required this.selected});

  final bool selected;

  @override
  Widget build(BuildContext context) => Container(
        height: 34,
        padding: const EdgeInsets.symmetric(horizontal: 7),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(RhythmRadius.md),
          border: selected
              ? Border(
                  bottom: BorderSide(color: context.rhythm.accent, width: 2),
                )
              : null,
        ),
        child: Text(
          'More',
          style: TextStyle(
            color: selected
                ? context.rhythm.textPrimary
                : context.rhythm.textSecondary,
            fontSize: 13,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          ),
        ),
      );
}

class _UnreadBadge extends StatelessWidget {
  const _UnreadBadge({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) => Semantics(
        container: true,
        label: '$count unread messages',
        child: ExcludeSemantics(
          child: Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: context.rhythm.accent,
              shape: BoxShape.circle,
            ),
          ),
        ),
      );
}
