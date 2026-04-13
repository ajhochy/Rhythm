import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:window_manager/window_manager.dart';

import '../../../features/messages/controllers/messages_controller.dart';
import '../../../features/dashboard/controllers/dashboard_controller.dart';
import '../../../features/integrations/controllers/integrations_controller.dart';
import '../../../features/dashboard/views/dashboard_view.dart';
import '../../../features/facilities/views/facilities_view.dart';
import '../../../features/integrations/models/integration_account.dart';
import '../../../features/integrations/views/integrations_view.dart';
import '../../../features/projects/views/projects_view.dart';
import '../../../features/rhythms/views/rhythms_view.dart';
import '../../../features/settings/views/settings_view.dart';
import '../../../features/tasks/views/automation_rules_view.dart';
import '../../../features/messages/views/messages_view.dart';
import '../../../features/tasks/views/tasks_view.dart';
import '../../../features/weekly_planner/views/weekly_planner_view.dart';
import '../server/api_server_controller.dart';
import '../auth/auth_session_service.dart';
import '../workspace/workspace_onboarding_view.dart';
import '../updates/update_controller.dart';
import '../constants/app_constants.dart';
import 'navigation_sidebar.dart';
import '../../theme/rhythm_tokens.dart';

class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> with WindowListener {
  int _selectedIndex = 0;
  bool _sidebarCollapsed = false;

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
    if (ApiServerController.useEmbeddedServer) {
      context.read<ApiServerController>().dispose();
    }
    await windowManager.destroy();
  }

  @override
  Widget build(BuildContext context) {
    final serverStatus = context.watch<ApiServerController>().status;
    final authStatus = context.watch<AuthSessionService>().status;
    final messagesController = context.read<MessagesController>();
    final enableMessagePolling = serverStatus == ServerStatus.ready &&
        authStatus == AuthStatus.authenticated;
    final isMessagesScreenActive = enableMessagePolling && _selectedIndex == 5;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      messagesController.setPollingEnabled(enableMessagePolling);
      messagesController.setScreenActive(isMessagesScreenActive);
    });

    return switch (serverStatus) {
      ServerStatus.starting => const _ServerLoadingView(),
      ServerStatus.failed => _ServerFailedView(
          onRetry: () => context.read<ApiServerController>().retry(),
          errorMessage: context.watch<ApiServerController>().errorMessage,
        ),
      ServerStatus.ready => _AuthGate(
          child: _AppContent(
            selectedIndex: _selectedIndex,
            sidebarCollapsed: _sidebarCollapsed,
            onToggleSidebarCollapsed: () {
              setState(() => _sidebarCollapsed = !_sidebarCollapsed);
            },
            onItemSelected: (i) {
              setState(() => _selectedIndex = i);
              if (i == 0) {
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  if (!mounted) return;
                  context.read<DashboardController>().refresh();
                });
              }
            },
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
                fontSize: 16,
                color: cs.onSurface.withValues(alpha: 0.6),
              ),
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
  const _ServerFailedView({required this.onRetry, this.errorMessage});

  final VoidCallback onRetry;
  final String? errorMessage;

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
              errorMessage ?? 'Could not start the Rhythm server.',
              style: TextStyle(fontSize: 16, color: cs.onSurface),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            if (errorMessage == null)
              Text(
                'Make sure Node.js is installed and try again.',
                style: TextStyle(color: cs.onSurface.withValues(alpha: 0.6)),
              ),
            const SizedBox(height: 24),
            FilledButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Normal app content (shown once server is ready)
// ---------------------------------------------------------------------------

// Current order: Dashboard(0), Weekly Planner(1), Tasks(2), Rhythms(3),
//                Projects(4), Messages(5), Facilities(6),
//                Automations(7), Integrations(8)
class _AppContent extends StatelessWidget {
  const _AppContent({
    required this.selectedIndex,
    required this.sidebarCollapsed,
    required this.onToggleSidebarCollapsed,
    required this.onItemSelected,
  });

  final int selectedIndex;
  final bool sidebarCollapsed;
  final VoidCallback onToggleSidebarCollapsed;
  final ValueChanged<int> onItemSelected;

  @override
  Widget build(BuildContext context) {
    final updateController = context.watch<UpdateController>();
    final authSessionService = context.watch<AuthSessionService>();
    final views = <Widget>[
      DashboardView(
        openWeeklyPlanner: () => onItemSelected(AppConstants.navWeeklyPlanner),
        openRhythms: () => onItemSelected(AppConstants.navRhythms),
        openProjects: () => onItemSelected(AppConstants.navProjects),
        openMessages: () => onItemSelected(AppConstants.navMessages),
      ),
      const WeeklyPlannerView(),
      const TasksView(),
      const RhythmsView(),
      const ProjectsView(),
      const MessagesView(),
      const FacilitiesView(),
      const AutomationRulesView(),
      const IntegrationsView(),
    ];
    return Scaffold(
      backgroundColor: RhythmTokens.background,
      body: Stack(
        children: [
          const _ShellBackdrop(),
          Row(
            children: [
              NavigationSidebar(
                selectedIndex: selectedIndex,
                collapsed: sidebarCollapsed,
                onItemSelected: onItemSelected,
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
                  child: Column(
                    children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(4, 0, 4, 10),
                        child: Row(
                          children: [
                            IconButton(
                              onPressed: onToggleSidebarCollapsed,
                              tooltip: sidebarCollapsed
                                  ? 'Expand sidebar'
                                  : 'Collapse sidebar',
                              style: IconButton.styleFrom(
                                backgroundColor: RhythmTokens.surfaceStrong,
                                foregroundColor: RhythmTokens.textPrimary,
                                side: const BorderSide(
                                  color: RhythmTokens.borderSoft,
                                ),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(
                                    RhythmTokens.radiusM,
                                  ),
                                ),
                              ),
                              icon: Icon(
                                sidebarCollapsed ? Icons.menu_open : Icons.menu,
                                size: 18,
                              ),
                            ),
                            const Spacer(),
                            _TopRightAccountCluster(
                              authSessionService: authSessionService,
                              updateController: updateController,
                            ),
                          ],
                        ),
                      ),
                      Expanded(
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(
                            RhythmTokens.radiusL,
                          ),
                          child: Material(
                            color: RhythmTokens.surface,
                            child: views[selectedIndex],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _TopRightAccountCluster extends StatelessWidget {
  const _TopRightAccountCluster({
    required this.authSessionService,
    required this.updateController,
  });

  final AuthSessionService authSessionService;
  final UpdateController updateController;

  @override
  Widget build(BuildContext context) {
    final user = authSessionService.currentUser;
    if (user == null) {
      return const SizedBox.shrink();
    }

    final hasUpdate = updateController.availableUpdate != null;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (hasUpdate)
          Container(
            margin: const EdgeInsets.only(right: 10),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: RhythmTokens.surfaceStrong,
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: RhythmTokens.borderSoft),
            ),
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.system_update_alt,
                  size: 14,
                  color: RhythmTokens.accent,
                ),
                SizedBox(width: 6),
                Text(
                  'Update ready',
                  style: TextStyle(
                    color: RhythmTokens.textPrimary,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        Material(
          color: RhythmTokens.surfaceStrong.withValues(alpha: 0.96),
          borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
          child: InkWell(
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const SettingsView()),
              );
            },
            borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
                border: Border.all(color: RhythmTokens.borderSoft),
                boxShadow: RhythmTokens.shadow,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircleAvatar(
                    radius: 18,
                    backgroundColor: RhythmTokens.accentSoft,
                    backgroundImage: user.photoUrl != null
                        ? NetworkImage(user.photoUrl!)
                        : null,
                    child: user.photoUrl == null
                        ? Text(
                            _initialsFor(user.name),
                            style: const TextStyle(
                              color: RhythmTokens.accent,
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                            ),
                          )
                        : null,
                  ),
                  const SizedBox(width: 10),
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 220),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          user.name,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: RhythmTokens.textPrimary,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 1),
                        Text(
                          user.email,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: RhythmTokens.textSecondary,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  const Icon(
                    Icons.keyboard_arrow_down,
                    color: RhythmTokens.textSecondary,
                    size: 18,
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

String _initialsFor(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty)
      .take(2)
      .toList();
  if (parts.isEmpty) return '?';
  return parts.map((part) => part[0].toUpperCase()).join();
}

class _ShellBackdrop extends StatelessWidget {
  const _ShellBackdrop();

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              RhythmTokens.backgroundAccent.withValues(alpha: 0.35),
              RhythmTokens.background,
              RhythmTokens.background.withValues(alpha: 0.92),
            ],
          ),
        ),
        child: const SizedBox.expand(),
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
  bool _checkingGoogleAccess = false;
  bool _googleAccessReady = false;
  bool _launchAttempted = false;
  bool _syncingGoogleAccess = false;
  String? _googleAccessError;
  Timer? _googleAccessPollTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AuthSessionService>().restoreSession();
    });
  }

  @override
  void dispose() {
    _googleAccessPollTimer?.cancel();
    super.dispose();
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
      _googleAccessReady = false;
      _launchAttempted = false;
      _checkingGoogleAccess = false;
      _syncingGoogleAccess = false;
      _googleAccessError = null;
      _googleAccessPollTimer?.cancel();
    }

    if (auth.isAuthenticated && !_googleAccessReady && !_checkingGoogleAccess) {
      _checkingGoogleAccess = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _checkGoogleAccess();
      });
    }

    return switch (auth.status) {
      AuthStatus.checking || AuthStatus.signingIn => const _AuthLoadingView(),
      AuthStatus.authenticated => _googleAccessReady
          ? (auth.hasWorkspace ? widget.child : const WorkspaceOnboardingView())
          : _GooglePermissionsGate(
              syncing: _syncingGoogleAccess,
              launching: _launchAttempted,
              errorMessage: _googleAccessError,
              onContinue: _beginGoogleAccessSetup,
              onRefresh: _checkGoogleAccess,
            ),
      AuthStatus.unauthenticated => const _LoginView(),
    };
  }

  Future<void> _checkGoogleAccess() async {
    if (!mounted) return;
    final integrations = context.read<IntegrationsController>();
    try {
      await integrations.load();
      final ready = _hasGoogleAccess(integrations);
      if (!mounted) return;
      setState(() {
        _googleAccessReady = ready;
        _checkingGoogleAccess = false;
        _googleAccessError = integrations.errorMessage;
      });
      if (!ready && !_launchAttempted) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted || _googleAccessReady) return;
          _beginGoogleAccessSetup();
        });
      }
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _checkingGoogleAccess = false;
        _googleAccessReady = false;
        _googleAccessError = error.toString();
      });
    }
  }

  bool _hasGoogleAccess(IntegrationsController integrations) {
    final accounts = integrations.accounts;
    final calendarAccount = _accountFor(accounts, 'google_calendar');
    final gmailAccount = _accountFor(accounts, 'gmail');
    final calendarReady = calendarAccount != null &&
        calendarAccount.connected == true &&
        calendarAccount.scope?.contains(
              'https://www.googleapis.com/auth/calendar.readonly',
            ) ==
            true;
    final gmailReady = gmailAccount != null &&
        gmailAccount.connected == true &&
        gmailAccount.scope?.contains(
              'https://www.googleapis.com/auth/gmail.metadata',
            ) ==
            true;
    return calendarReady && gmailReady;
  }

  IntegrationAccount? _accountFor(
    List<IntegrationAccount> accounts,
    String provider,
  ) {
    for (final account in accounts) {
      if (account.provider == provider) return account;
    }
    return null;
  }

  Future<void> _beginGoogleAccessSetup() async {
    if (!mounted || _syncingGoogleAccess) return;
    final integrations = context.read<IntegrationsController>();
    setState(() {
      _launchAttempted = true;
      _googleAccessError = null;
    });
    try {
      final uri = integrations.googleBeginUri();
      final command = Platform.isMacOS ? 'open' : 'xdg-open';
      await Process.run(command, [uri.toString()]);
      _startGoogleAccessPolling();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _googleAccessError = error.toString();
      });
    }
  }

  void _startGoogleAccessPolling() {
    _googleAccessPollTimer?.cancel();
    _googleAccessPollTimer = Timer.periodic(const Duration(seconds: 2), (
      timer,
    ) async {
      if (!mounted) {
        timer.cancel();
        return;
      }
      final integrations = context.read<IntegrationsController>();
      await integrations.load();
      if (!_hasGoogleAccess(integrations)) {
        if (mounted) {
          setState(() {
            _googleAccessError = integrations.errorMessage;
          });
        }
        return;
      }

      timer.cancel();
      if (!mounted) return;
      setState(() {
        _syncingGoogleAccess = true;
        _googleAccessError = null;
      });
      try {
        await integrations.syncGoogleCalendar();
        await integrations.syncGmail();
        await integrations.load();
        if (!mounted) return;
        setState(() {
          _googleAccessReady = true;
          _syncingGoogleAccess = false;
        });
      } catch (error) {
        if (!mounted) return;
        setState(() {
          _syncingGoogleAccess = false;
          _googleAccessError = error.toString();
        });
      }
    });
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

class _GooglePermissionsGate extends StatelessWidget {
  const _GooglePermissionsGate({
    required this.syncing,
    required this.launching,
    required this.onContinue,
    required this.onRefresh,
    this.errorMessage,
  });

  final bool syncing;
  final bool launching;
  final String? errorMessage;
  final VoidCallback onContinue;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: Colors.white,
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(28),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Finish Google Setup',
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Rhythm needs Gmail and Google Calendar permission once so your inbox and calendar shadow events are ready automatically after login.',
                    style: Theme.of(context).textTheme.bodyLarge,
                  ),
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: cs.primary.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Row(
                      children: [
                        if (syncing)
                          SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: cs.primary,
                            ),
                          )
                        else
                          Icon(Icons.link, color: cs.primary),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            syncing
                                ? 'Google permissions granted. Syncing Gmail and Calendar now...'
                                : launching
                                    ? 'Waiting for Google permissions to complete in your browser...'
                                    : 'A browser window will open for one-time Google consent.',
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (errorMessage != null &&
                      errorMessage!.trim().isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Text(errorMessage!, style: TextStyle(color: cs.error)),
                  ],
                  const SizedBox(height: 20),
                  Row(
                    children: [
                      FilledButton(
                        onPressed: syncing ? null : onContinue,
                        child: Text(launching ? 'Open Again' : 'Continue'),
                      ),
                      const SizedBox(width: 10),
                      OutlinedButton(
                        onPressed: syncing ? null : onRefresh,
                        child: const Text('Refresh Status'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
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
                Text(auth.errorMessage!, style: TextStyle(color: cs.error)),
              ],
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: auth.status == AuthStatus.signingIn
                      ? null
                      : () =>
                          context.read<AuthSessionService>().signInWithGoogle(),
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
