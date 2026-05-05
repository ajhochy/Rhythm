import 'package:flutter/material.dart';

import '../../../../features/tasks/views/today_view.dart';
import '../ui/tokens/rhythm_theme.dart';

/// Root shell shown after successful authentication.
///
/// Three tabs: Today (0), Add (1), Settings (2).
/// Uses [IndexedStack] so tab state is preserved on switch.
class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _currentIndex = 0;

  static const _tabs = [
    TodayView(),
    Center(child: Text('Add')),
    Center(child: Text('Settings')),
  ];

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return Scaffold(
      backgroundColor: colors.canvas,
      body: IndexedStack(
        index: _currentIndex,
        children: _tabs,
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex,
        onTap: (index) => setState(() => _currentIndex = index),
        selectedItemColor: colors.accent,
        unselectedItemColor: colors.textSecondary,
        backgroundColor: colors.surfaceRaised,
        items: const [
          BottomNavigationBarItem(
            icon: Icon(Icons.today),
            label: 'Today',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.add_circle_outline),
            label: 'Add',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.settings),
            label: 'Settings',
          ),
        ],
      ),
    );
  }
}
