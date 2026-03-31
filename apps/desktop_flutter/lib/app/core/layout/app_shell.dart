import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:window_manager/window_manager.dart';

import '../../../features/dashboard/views/dashboard_view.dart';
import '../../../features/facilities/views/facilities_view.dart';
import '../../../features/integrations/views/integrations_view.dart';
import '../../../features/projects/views/projects_view.dart';
import '../../../features/rhythms/views/rhythms_view.dart';
import '../../../features/tasks/views/automation_rules_view.dart';
import '../../../features/tasks/views/tasks_view.dart';
import '../../../features/weekly_planner/views/weekly_planner_view.dart';
import '../server/api_server_controller.dart';
import '../updates/update_controller.dart';
import 'navigation_sidebar.dart';

class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> with WindowListener {
  int _selectedIndex = 0;

  @override
  void initState() {
    super.initState();
    windowManager.addListener(this);
    // Intercept the close event so we can stop the server cleanly first.
    windowManager.setPreventClose(true);
  }

  @override
  void dispose() {
    windowManager.removeListener(this);
    super.dispose();
  }

  @override
  void onWindowClose() async {
    context.read<ApiServerController>().dispose();
    await windowManager.destroy();
  }

  @override
  Widget build(BuildContext context) {
    final serverStatus = context.watch<ApiServerController>().status;

    return switch (serverStatus) {
      ServerStatus.starting => const _ServerLoadingView(),
      ServerStatus.failed => _ServerFailedView(
          onRetry: () => context.read<ApiServerController>().retry(),
        ),
      ServerStatus.ready => _AppContent(
          selectedIndex: _selectedIndex,
          onItemSelected: (i) => setState(() => _selectedIndex = i),
        ),
    };
  }
}

// ---------------------------------------------------------------------------
// Server loading splash
// ---------------------------------------------------------------------------

class _ServerLoadingView extends StatelessWidget {
  const _ServerLoadingView();

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: const Color(0xFFFFFFFF),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: cs.primary),
            const SizedBox(height: 20),
            Text(
              'Starting Rhythm\u2026',
              style: TextStyle(
                  fontSize: 16, color: cs.onSurface.withValues(alpha: 0.6)),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Server failed view
// ---------------------------------------------------------------------------

class _ServerFailedView extends StatelessWidget {
  const _ServerFailedView({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: const Color(0xFFFFFFFF),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 48, color: cs.error),
            const SizedBox(height: 16),
            Text(
              'Could not start the Rhythm server.',
              style: TextStyle(fontSize: 16, color: cs.onSurface),
            ),
            const SizedBox(height: 8),
            Text(
              'Make sure Node.js is installed and try again.',
              style: TextStyle(color: cs.onSurface.withValues(alpha: 0.6)),
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: onRetry,
              child: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Normal app content (shown once server is ready)
// ---------------------------------------------------------------------------

// New order: Dashboard(0), Tasks(1), Rhythms(2), Projects(3),
//            Weekly Planner(4), Messages(5), Facilities(6),
//            Automations(7), Integrations(8)
class _AppContent extends StatelessWidget {
  const _AppContent({
    required this.selectedIndex,
    required this.onItemSelected,
  });

  final int selectedIndex;
  final ValueChanged<int> onItemSelected;

  static const _views = <Widget>[
    DashboardView(), // 0
    TasksView(), // 1
    RhythmsView(), // 2
    ProjectsView(), // 3
    WeeklyPlannerView(), // 4
    _ComingSoonView(label: 'Messages'), // 5
    FacilitiesView(), // 6
    AutomationRulesView(), // 7
    IntegrationsView(), // 8
  ];

  @override
  Widget build(BuildContext context) {
    final updateController = context.watch<UpdateController>();
    return Scaffold(
      body: Row(
        children: [
          NavigationSidebar(
            selectedIndex: selectedIndex,
            onItemSelected: onItemSelected,
            updateController: updateController,
          ),
          Expanded(child: _views[selectedIndex]),
        ],
      ),
    );
  }
}

class _ComingSoonView extends StatelessWidget {
  const _ComingSoonView({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Text(
          '$label \u2014 Coming soon',
          style: Theme.of(context)
              .textTheme
              .titleMedium
              ?.copyWith(color: const Color(0xFF6B7280)),
        ),
      ),
    );
  }
}
