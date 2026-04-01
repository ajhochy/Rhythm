import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:window_manager/window_manager.dart';

import '../../../features/messages/controllers/messages_controller.dart';
import '../../../features/dashboard/views/dashboard_view.dart';
import '../../../features/facilities/views/facilities_view.dart';
import '../../../features/integrations/views/integrations_view.dart';
import '../../../features/projects/views/projects_view.dart';
import '../../../features/rhythms/views/rhythms_view.dart';
import '../../../features/tasks/views/automation_rules_view.dart';
import '../../../features/messages/views/messages_view.dart';
import '../../../features/tasks/views/tasks_view.dart';
import '../../../features/weekly_planner/views/weekly_planner_view.dart';
import '../server/api_server_controller.dart';
import '../auth/auth_session_service.dart';
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
      ServerStatus.ready => _AuthGate(
          child: _AppContent(
            selectedIndex: _selectedIndex,
            onItemSelected: (i) => setState(() => _selectedIndex = i),
          ),
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
    MessagesView(), // 5
    FacilitiesView(), // 6
    AutomationRulesView(), // 7
    IntegrationsView(), // 8
  ];

  @override
  Widget build(BuildContext context) {
    final updateController = context.watch<UpdateController>();
    final authSessionService = context.watch<AuthSessionService>();
    return Scaffold(
      body: Row(
        children: [
          NavigationSidebar(
            selectedIndex: selectedIndex,
            onItemSelected: onItemSelected,
            updateController: updateController,
            authSessionService: authSessionService,
          ),
          Expanded(child: _views[selectedIndex]),
        ],
      ),
    );
  }
}

class _AuthGate extends StatefulWidget {
  const _AuthGate({required this.child});

  final Widget child;

  @override
  State<_AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<_AuthGate> {
  bool _primedMessages = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AuthSessionService>().restoreSession();
    });
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthSessionService>();
    if (auth.isAuthenticated && !_primedMessages) {
      _primedMessages = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        context.read<MessagesController>().loadThreads();
      });
    }
    if (!auth.isAuthenticated) {
      _primedMessages = false;
    }

    return switch (auth.status) {
      AuthStatus.checking || AuthStatus.signingIn => const _AuthLoadingView(),
      AuthStatus.authenticated => widget.child,
      AuthStatus.unauthenticated => const _LoginView(),
    };
  }
}

class _AuthLoadingView extends StatelessWidget {
  const _AuthLoadingView();

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: Colors.white,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: cs.primary),
            const SizedBox(height: 20),
            const Text('Checking your Rhythm session...'),
          ],
        ),
      ),
    );
  }
}

class _LoginView extends StatelessWidget {
  const _LoginView();

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthSessionService>();
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: const Color(0xFFF3F4F6),
      body: Center(
        child: Container(
          width: 420,
          padding: const EdgeInsets.all(32),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: const Color(0xFFE5E7EB)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Sign in to Rhythm',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      color: const Color(0xFF111827),
                      fontWeight: FontWeight.w700,
                    ),
              ),
              const SizedBox(height: 12),
              const Text(
                'Use your Google Workspace account to access personal tasks, messages, and planning data.',
                style: TextStyle(color: Color(0xFF6B7280), height: 1.4),
              ),
              if (auth.errorMessage != null) ...[
                const SizedBox(height: 16),
                Text(
                  auth.errorMessage!,
                  style: TextStyle(color: cs.error),
                ),
              ],
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: auth.status == AuthStatus.signingIn
                      ? null
                      : () => context.read<AuthSessionService>().signInWithGoogle(),
                  icon: const Icon(Icons.login),
                  label: const Text('Continue with Google'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
