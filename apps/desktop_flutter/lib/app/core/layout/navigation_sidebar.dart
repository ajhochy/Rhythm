import 'package:flutter/material.dart';

class NavigationSidebar extends StatelessWidget {
  const NavigationSidebar({
    super.key,
    required this.selectedIndex,
    required this.onItemSelected,
  });

  final int selectedIndex;
  final ValueChanged<int> onItemSelected;

  static const _items = [
    _NavItem(icon: Icons.calendar_view_week, label: 'Weekly Planner'),
    _NavItem(icon: Icons.check_circle_outline, label: 'Tasks'),
    _NavItem(icon: Icons.repeat, label: 'Rhythms'),
    _NavItem(icon: Icons.folder_open, label: 'Projects'),
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
