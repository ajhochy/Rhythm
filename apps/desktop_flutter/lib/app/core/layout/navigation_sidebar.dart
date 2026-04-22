import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../features/messages/controllers/messages_controller.dart';
import '../../../features/settings/views/settings_view.dart';
import '../constants/app_constants.dart';
import '../ui/tokens/rhythm_theme.dart';

class NavigationSidebar extends StatelessWidget {
  const NavigationSidebar({
    super.key,
    required this.selectedIndex,
    required this.collapsed,
    required this.onItemSelected,
  });

  final int selectedIndex;
  final bool collapsed;
  final ValueChanged<int> onItemSelected;

  static const _items = [
    _NavItem(icon: Icons.dashboard_outlined, label: 'Dashboard'),
    _NavItem(icon: Icons.calendar_view_week, label: 'Weekly Planner'),
    _NavItem(icon: Icons.check_circle_outline, label: 'Tasks'),
    _NavItem(icon: Icons.repeat, label: 'Rhythms'),
    _NavItem(icon: Icons.folder_open, label: 'Projects'),
    _NavItem(icon: Icons.chat_bubble_outline, label: 'Messages'),
    _NavItem(icon: Icons.meeting_room_outlined, label: 'Facilities'),
    _NavItem(icon: Icons.auto_awesome, label: 'Automations'),
    _NavItem(icon: Icons.link, label: 'Integrations'),
  ];

  @override
  Widget build(BuildContext context) {
    final unreadCount = context.watch<MessagesController>().totalUnreadCount;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      width: collapsed ? 76 : 260,
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        border: Border(
          right: BorderSide(color: context.rhythm.borderSubtle),
        ),
      ),
      padding: EdgeInsets.fromLTRB(
        collapsed ? 10 : 16,
        14,
        collapsed ? 10 : 16,
        14,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: EdgeInsets.symmetric(
              horizontal: collapsed ? 8 : 14,
              vertical: collapsed ? 10 : 14,
            ),
            decoration: BoxDecoration(
              color: context.rhythm.surfaceRaised,
              borderRadius: BorderRadius.circular(RhythmRadius.xl),
              border: Border.all(color: context.rhythm.borderSubtle),
              boxShadow: RhythmElevation.panel,
            ),
            child: Row(
              mainAxisAlignment: collapsed
                  ? MainAxisAlignment.center
                  : MainAxisAlignment.start,
              children: [
                Container(
                  width: 30,
                  height: 30,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: context.rhythm.borderSubtle),
                    image: const DecorationImage(
                      image: AssetImage('assets/branding/rhythm_logo.png'),
                      fit: BoxFit.cover,
                    ),
                  ),
                ),
                if (!collapsed) ...[
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Rhythm',
                      style: TextStyle(
                        color: context.rhythm.textPrimary,
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.2,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 14),
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (!collapsed) ...[
                    Text(
                      'Workspace',
                      style: TextStyle(
                        color: context.rhythm.textMuted,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 1.2,
                      ),
                    ),
                    const SizedBox(height: 8),
                  ],
                  for (int i = 0; i < _items.length; i++) ...[
                    _NavItemTile(
                      item: _items[i],
                      isSelected: i == selectedIndex,
                      collapsed: collapsed,
                      onTap: () => onItemSelected(i),
                      badgeCount:
                          i == AppConstants.navMessages ? unreadCount : null,
                    ),
                    const SizedBox(height: 6),
                  ],
                  const SizedBox(height: 12),
                  _SettingsButton(collapsed: collapsed),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _NavItem {
  const _NavItem({required this.icon, required this.label});
  final IconData icon;
  final String label;
}

class _NavItemTile extends StatelessWidget {
  const _NavItemTile({
    required this.item,
    required this.isSelected,
    required this.collapsed,
    required this.onTap,
    this.badgeCount,
  });

  final _NavItem item;
  final bool isSelected;
  final bool collapsed;
  final VoidCallback onTap;
  final int? badgeCount;

  @override
  Widget build(BuildContext context) {
    final tile = AnimatedContainer(
      duration: const Duration(milliseconds: 160),
      padding: EdgeInsets.symmetric(
        horizontal: collapsed ? 0 : 12,
        vertical: collapsed ? 12 : 11,
      ),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised,
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        border: Border.all(
          color: isSelected
              ? context.rhythm.accentMuted
              : context.rhythm.borderSubtle,
        ),
        boxShadow: isSelected ? RhythmElevation.panel : const [],
      ),
      child: Row(
        mainAxisAlignment:
            collapsed ? MainAxisAlignment.center : MainAxisAlignment.start,
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              Icon(
                item.icon,
                color: isSelected
                    ? context.rhythm.accent
                    : context.rhythm.textSecondary,
                size: 18,
              ),
              if ((badgeCount ?? 0) > 0)
                Positioned(
                  right: -7,
                  top: -7,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 5,
                      vertical: 1,
                    ),
                    decoration: BoxDecoration(
                      color: context.rhythm.danger,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      '${badgeCount!}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
            ],
          ),
          if (!collapsed) ...[
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                item.label,
                style: TextStyle(
                  color: isSelected
                      ? context.rhythm.textPrimary
                      : context.rhythm.textSecondary,
                  fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ),
          ],
        ],
      ),
    );

    return Tooltip(
      message: item.label,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        child: tile,
      ),
    );
  }
}

class _SettingsButton extends StatelessWidget {
  const _SettingsButton({required this.collapsed});

  final bool collapsed;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: 'Settings',
      child: InkWell(
        onTap: () {
          Navigator.of(
            context,
          ).push(MaterialPageRoute<void>(builder: (_) => const SettingsView()));
        },
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        child: Container(
          padding: EdgeInsets.symmetric(
            horizontal: collapsed ? 0 : 12,
            vertical: 12,
          ),
          decoration: BoxDecoration(
            color: context.rhythm.surfaceRaised,
            borderRadius: BorderRadius.circular(RhythmRadius.lg),
            border: Border.all(color: context.rhythm.borderSubtle),
          ),
          child: Row(
            mainAxisAlignment:
                collapsed ? MainAxisAlignment.center : MainAxisAlignment.start,
            children: [
              Icon(
                Icons.settings_outlined,
                color: context.rhythm.textSecondary,
                size: 18,
              ),
              if (!collapsed) ...[
                const SizedBox(width: 10),
                Text(
                  'Settings',
                  style: TextStyle(color: context.rhythm.textSecondary),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
