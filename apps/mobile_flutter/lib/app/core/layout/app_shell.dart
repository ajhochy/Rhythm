import 'package:flutter/material.dart';

import '../../../../features/tasks/views/quick_add_view.dart';
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

  /// Key used to call [QuickAddViewState.requestTitleFocus] when the Add tab
  /// becomes active.
  final _quickAddKey = GlobalKey<QuickAddViewState>();

  void _onTabTap(int index) {
    final wasOnAdd = _currentIndex == 1;
    setState(() {
      _currentIndex = index;
    });
    // Request focus on the title field whenever the Add tab is selected.
    if (index == 1 && !wasOnAdd) {
      _quickAddKey.currentState?.requestTitleFocus();
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;

    final tabs = [
      const TodayView(),
      QuickAddView(
        key: _quickAddKey,
        onTaskCreated: () => setState(() => _currentIndex = 0),
      ),
      const Center(child: Text('Settings')),
    ];

    return Scaffold(
      backgroundColor: colors.canvas,
      body: IndexedStack(
        index: _currentIndex,
        children: tabs,
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex,
        onTap: _onTabTap,
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
