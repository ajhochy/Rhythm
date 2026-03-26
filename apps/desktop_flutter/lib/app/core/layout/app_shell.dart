import 'package:flutter/material.dart';
import '../../../features/integrations/views/integrations_view.dart';
import '../../../features/projects/views/projects_view.dart';
import '../../../features/rhythms/views/rhythms_view.dart';
import '../../../features/tasks/views/tasks_view.dart';
import '../../../features/weekly_planner/views/weekly_planner_view.dart';
import 'navigation_sidebar.dart';

class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _selectedIndex = 0;

  static const _views = [
    WeeklyPlannerView(),
    TasksView(),
    RhythmsView(),
    ProjectsView(),
    IntegrationsView(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Row(
        children: [
          NavigationSidebar(
            selectedIndex: _selectedIndex,
            onItemSelected: (i) => setState(() => _selectedIndex = i),
          ),
          Expanded(child: _views[_selectedIndex]),
        ],
      ),
    );
  }
}
