import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:window_manager/window_manager.dart';

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
    return const Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 20),
            Text(
              'Starting Rhythm…',
              style: TextStyle(fontSize: 16, color: Colors.black54),
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
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, size: 48, color: Colors.red),
            const SizedBox(height: 16),
            const Text(
              'Could not start the Rhythm server.',
              style: TextStyle(fontSize: 16),
            ),
            const SizedBox(height: 8),
            const Text(
              'Make sure Node.js is installed and try again.',
              style: TextStyle(color: Colors.black54),
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

class _AppContent extends StatelessWidget {
  const _AppContent({
    required this.selectedIndex,
    required this.onItemSelected,
  });

  final int selectedIndex;
  final ValueChanged<int> onItemSelected;

  static const _views = [
    WeeklyPlannerView(),
    TasksView(),
    RhythmsView(),
    ProjectsView(),
    AutomationRulesView(),
    IntegrationsView(),
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
