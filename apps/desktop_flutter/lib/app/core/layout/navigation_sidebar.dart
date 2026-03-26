import 'package:flutter/material.dart';

import '../updates/update_controller.dart';

class NavigationSidebar extends StatelessWidget {
  const NavigationSidebar({
    super.key,
    required this.selectedIndex,
    required this.onItemSelected,
    required this.updateController,
  });

  final int selectedIndex;
  final ValueChanged<int> onItemSelected;
  final UpdateController updateController;

  static const _items = [
    _NavItem(icon: Icons.calendar_view_week, label: 'Weekly Planner'),
    _NavItem(icon: Icons.check_circle_outline, label: 'Tasks'),
    _NavItem(icon: Icons.repeat, label: 'Rhythms'),
    _NavItem(icon: Icons.folder_open, label: 'Projects'),
    _NavItem(icon: Icons.auto_awesome, label: 'Automations'),
    _NavItem(icon: Icons.link, label: 'Integrations'),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 240,
      color: const Color(0xFF1F1F1F),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(bottom: 24),
            child: Text('Rhythm',
                style: TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.bold)),
          ),
          for (int i = 0; i < _items.length; i++) ...[
            _NavItemTile(
              item: _items[i],
              isSelected: i == selectedIndex,
              onTap: () => onItemSelected(i),
            ),
            const SizedBox(height: 4),
          ],
          const Spacer(),
          _UpdatePanel(controller: updateController),
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
      {required this.item, required this.isSelected, required this.onTap});

  final _NavItem item;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: isSelected
              ? Colors.white.withValues(alpha: 0.12)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          children: [
            Icon(item.icon,
                color: isSelected ? Colors.white : Colors.white60, size: 18),
            const SizedBox(width: 10),
            Text(
              item.label,
              style: TextStyle(
                color: isSelected ? Colors.white : Colors.white70,
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
              ),
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
        color: Colors.white.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'App updates',
            style: TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            versionLabel,
            style: const TextStyle(color: Colors.white70, fontSize: 12),
          ),
          const SizedBox(height: 10),
          if (controller.isChecking)
            const Text(
              'Checking GitHub releases...',
              style: TextStyle(color: Colors.white70, fontSize: 12),
            )
          else if (update != null) ...[
            Text(
              'Update ready: ${update.version}${update.prerelease ? ' beta' : ''}',
              style: const TextStyle(
                color: Colors.white,
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
              style: TextStyle(color: Colors.white70, fontSize: 12),
            ),
            if (controller.errorMessage != null) ...[
              const SizedBox(height: 8),
              Text(
                controller.errorMessage!,
                style:
                    const TextStyle(color: Colors.orangeAccent, fontSize: 11),
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
          color: outlined ? Colors.transparent : Colors.white,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: Colors.white24),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: outlined ? Colors.white : const Color(0xFF1F1F1F),
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}
