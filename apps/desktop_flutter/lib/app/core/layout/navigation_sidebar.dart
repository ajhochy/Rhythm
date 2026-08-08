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

  static const _overflowIndices = {
    AppConstants.navFacilities,
    AppConstants.navAutomations,
    AppConstants.navIntegrations,
  };

  @override
  Widget build(BuildContext context) {
    final unreadCount = context.watch<MessagesController>().totalUnreadCount;
    return LayoutBuilder(
      builder: (context, constraints) {
        final isNarrow = constraints.maxWidth <
            1000 * MediaQuery.textScalerOf(context).scale(1);
        final items = isNarrow
            ? _items.where((item) => !_overflowIndices.contains(item.index))
            : _items;
        return Wrap(
          key: const ValueKey('global-navigation-tabs'),
          children: [
            for (final item in items)
              _WorkspaceTab(
                item: item,
                selected: selectedIndex == item.index,
                unreadCount:
                    item.index == AppConstants.navMessages ? unreadCount : null,
                onSelected: () => onItemSelected(item.index),
              ),
            if (isNarrow)
              _MoreMenu(
                selectedIndex: selectedIndex,
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
            style: TextButton.styleFrom(
              minimumSize: const Size(0, 34),
              padding: const EdgeInsets.symmetric(horizontal: 7),
              foregroundColor: selected
                  ? context.rhythm.textPrimary
                  : context.rhythm.textSecondary,
              backgroundColor:
                  selected ? context.rhythm.accentMuted : Colors.transparent,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.md),
                side: BorderSide(
                  color: selected
                      ? context.rhythm.accent.withValues(alpha: 0.55)
                      : Colors.transparent,
                ),
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  item.label,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  ),
                ),
                if ((unreadCount ?? 0) > 0) ...[
                  const SizedBox(width: 4),
                  _UnreadBadge(count: unreadCount!),
                ],
              ],
            ),
          ),
        ),
      );
}

class _MoreMenu extends StatelessWidget {
  const _MoreMenu({required this.selectedIndex, required this.onItemSelected});

  final int selectedIndex;
  final ValueChanged<int> onItemSelected;

  @override
  Widget build(BuildContext context) {
    final selected = NavigationSidebar._overflowIndices.contains(selectedIndex);
    return Semantics(
      button: true,
      selected: selected,
      label: 'More',
      child: PopupMenuButton<int>(
        tooltip: 'More',
        onSelected: onItemSelected,
        itemBuilder: (context) => [
          for (final item in NavigationSidebar._items.where(
            (item) => NavigationSidebar._overflowIndices.contains(item.index),
          ))
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
          color: selected ? context.rhythm.accentMuted : Colors.transparent,
          borderRadius: BorderRadius.circular(RhythmRadius.md),
          border: Border.all(
            color: selected
                ? context.rhythm.accent.withValues(alpha: 0.55)
                : Colors.transparent,
          ),
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
