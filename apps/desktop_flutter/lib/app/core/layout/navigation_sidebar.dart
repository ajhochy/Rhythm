import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../auth/auth_session_service.dart';
import '../../../features/messages/controllers/messages_controller.dart';
import '../../../features/settings/views/settings_view.dart';
import '../updates/update_controller.dart';

class NavigationSidebar extends StatelessWidget {
  const NavigationSidebar({
    super.key,
    required this.selectedIndex,
    required this.onItemSelected,
    required this.updateController,
    required this.authSessionService,
  });

  final int selectedIndex;
  final ValueChanged<int> onItemSelected;
  final UpdateController updateController;
  final AuthSessionService authSessionService;

  static const _items = [
    _NavItem(icon: Icons.dashboard_outlined, label: 'Dashboard'),
    _NavItem(icon: Icons.check_circle_outline, label: 'Tasks'),
    _NavItem(icon: Icons.repeat, label: 'Rhythms'),
    _NavItem(icon: Icons.folder_open, label: 'Projects'),
    _NavItem(icon: Icons.calendar_view_week, label: 'Weekly Planner'),
    _NavItem(icon: Icons.chat_bubble_outline, label: 'Messages'),
    _NavItem(icon: Icons.meeting_room_outlined, label: 'Facilities'),
    _NavItem(icon: Icons.auto_awesome, label: 'Automations'),
    _NavItem(icon: Icons.link, label: 'Integrations'),
  ];

  @override
  Widget build(BuildContext context) {
    final unreadCount = context.watch<MessagesController>().unreadThreadCount;
    return Container(
      width: 240,
      decoration: const BoxDecoration(
        color: Color(0xFFF8F9FA),
        border: Border(
          right: BorderSide(color: Color(0xFFE5E7EB)),
        ),
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(bottom: 24),
            child: Text(
              'Rhythm',
              style: TextStyle(
                color: Color(0xFF111827),
                fontSize: 20,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
          for (int i = 0; i < _items.length; i++) ...[
            _NavItemTile(
              item: _items[i],
              isSelected: i == selectedIndex,
              onTap: () => onItemSelected(i),
              badgeCount: i == 5 ? unreadCount : null,
            ),
            const SizedBox(height: 4),
          ],
          const Spacer(),
          if (authSessionService.currentUser != null) ...[
            _UserPanel(authSessionService: authSessionService),
            const SizedBox(height: 8),
          ],
          _UpdatePanel(controller: updateController),
          const SizedBox(height: 8),
          _SettingsButton(),
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
  const _NavItemTile(
      {required this.item,
      required this.isSelected,
      required this.onTap,
      this.badgeCount});

  final _NavItem item;
  final bool isSelected;
  final VoidCallback onTap;
  final int? badgeCount;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(6),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: isSelected ? const Color(0x144F6AF5) : Colors.transparent,
          borderRadius: BorderRadius.circular(6),
        ),
        child: Row(
          children: [
            Icon(
              item.icon,
              color: isSelected
                  ? const Color(0xFF4F6AF5)
                  : const Color(0xFF6B7280),
              size: 18,
            ),
            const SizedBox(width: 10),
            Text(
              item.label,
              style: TextStyle(
                color: isSelected
                    ? const Color(0xFF4F6AF5)
                    : const Color(0xFF6B7280),
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
              ),
            ),
            if ((badgeCount ?? 0) > 0) ...[
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: const Color(0xFFEF4444),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  '${badgeCount!}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _SettingsButton extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () {
        Navigator.of(context).push(
          MaterialPageRoute<void>(builder: (_) => const SettingsView()),
        );
      },
      borderRadius: BorderRadius.circular(6),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: const Row(
          children: [
            Icon(Icons.settings_outlined, color: Color(0xFF6B7280), size: 18),
            SizedBox(width: 10),
            Text(
              'Settings',
              style: TextStyle(color: Color(0xFF6B7280)),
            ),
          ],
        ),
      ),
    );
  }
}

class _UpdatePanel extends StatelessWidget {
  const _UpdatePanel({required this.controller});

  final UpdateController controller;

  @override
  Widget build(BuildContext context) {
    final update = controller.availableUpdate;
    final versionLabel = controller.currentVersion == null
        ? 'Version unknown'
        : 'v${controller.currentVersion}';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFFFF),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'App updates',
            style: TextStyle(
              color: Color(0xFF111827),
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            versionLabel,
            style: const TextStyle(color: Color(0xFF6B7280), fontSize: 12),
          ),
          const SizedBox(height: 10),
          if (controller.isChecking)
            const Text(
              'Checking GitHub releases...',
              style: TextStyle(color: Color(0xFF6B7280), fontSize: 12),
            )
          else if (update != null) ...[
            Text(
              'Update ready: ${update.version}${update.prerelease ? ' beta' : ''}',
              style: const TextStyle(
                color: Color(0xFF111827),
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _SidebarButton(
                  label: 'Download',
                  onTap: controller.openDownload,
                ),
                _SidebarButton(
                  label: 'Notes',
                  onTap: controller.openReleaseNotes,
                  outlined: true,
                ),
              ],
            ),
          ] else ...[
            const Text(
              'You are on the latest release.',
              style: TextStyle(color: Color(0xFF6B7280), fontSize: 12),
            ),
            if (controller.errorMessage != null) ...[
              const SizedBox(height: 8),
              Text(
                controller.errorMessage!,
                style: const TextStyle(color: Color(0xFFEF4444), fontSize: 11),
              ),
            ],
          ],
          const SizedBox(height: 8),
          _SidebarButton(
            label: 'Check now',
            onTap: controller.checkForUpdates,
            outlined: true,
          ),
        ],
      ),
    );
  }
}

class _UserPanel extends StatelessWidget {
  const _UserPanel({required this.authSessionService});

  final AuthSessionService authSessionService;

  @override
  Widget build(BuildContext context) {
    final user = authSessionService.currentUser!;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            user.name,
            style: const TextStyle(
              color: Color(0xFF111827),
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            user.email,
            style: const TextStyle(color: Color(0xFF6B7280), fontSize: 12),
          ),
          const SizedBox(height: 10),
          _SidebarButton(
            label: 'Sign out',
            onTap: authSessionService.logout,
            outlined: true,
          ),
        ],
      ),
    );
  }
}

class _SidebarButton extends StatelessWidget {
  const _SidebarButton({
    required this.label,
    required this.onTap,
    this.outlined = false,
  });

  final String label;
  final Future<void> Function() onTap;
  final bool outlined;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
        decoration: BoxDecoration(
          color: outlined ? Colors.transparent : const Color(0xFF4F6AF5),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: const Color(0xFFE5E7EB)),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: outlined ? const Color(0xFF6B7280) : Colors.white,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}
