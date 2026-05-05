import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app/core/auth/auth_data_source.dart';
import 'app/core/auth/auth_session_service.dart';
import 'app/core/auth/mobile_google_oauth_client.dart';
import 'app/core/layout/app_shell.dart';
import 'app/core/layout/splash_screen.dart';
import 'app/core/notifications/local_notification_service.dart';
import 'app/core/services/server_config_service.dart';
import 'app/theme/app_theme.dart';
import 'features/auth/views/login_screen.dart';
import 'features/reminders/services/reminder_preferences_service.dart';
import 'features/reminders/services/reminder_scheduler.dart';
import 'features/tasks/controllers/tasks_controller.dart';
import 'features/tasks/data/tasks_data_source.dart';
import 'features/tasks/repositories/tasks_repository.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // 1. Load persisted server URL.
  final serverConfig = ServerConfigService();
  await serverConfig.load();

  // 2. Construct auth dependencies from the resolved base URL.
  final baseUrl = serverConfig.url;
  final authDataSource = AuthDataSource(baseUrl: baseUrl);
  final oauthClient = MobileGoogleOAuthClient(baseUrl: baseUrl);

  // 3. Construct and restore the auth session.
  final authSession = AuthSessionService(
    authDataSource,
    oauthClient: oauthClient,
  );
  await authSession.restoreSession();

  // 4. Construct tasks layer.
  final tasksDataSource = TasksDataSource(baseUrl: baseUrl);
  final tasksRepository = TasksRepository(tasksDataSource);
  final tasksController = TasksController(tasksRepository);

  // 5. Initialize local notification service.
  final notificationService = LocalNotificationService();
  await notificationService.initialize();

  // 6. Load reminder preferences.
  final reminderPrefsService = ReminderPreferencesService();
  await reminderPrefsService.load();

  // 7. Wire scheduler — re-schedules whenever tasks or prefs change.
  final scheduler = ReminderScheduler(
    tasksController: tasksController,
    notificationService: notificationService,
    preferencesService: reminderPrefsService,
  );
  tasksController.addListener(scheduler.reschedule);
  reminderPrefsService.addListener(scheduler.reschedule);

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<ServerConfigService>.value(value: serverConfig),
        ChangeNotifierProvider<AuthSessionService>.value(value: authSession),
        // TasksController is wired here; load() is triggered by the Today view.
        ChangeNotifierProvider<TasksController>.value(value: tasksController),
        // LocalNotificationService exposed for schedulers (permissions deferred).
        Provider<LocalNotificationService>.value(value: notificationService),
        ChangeNotifierProvider<ReminderPreferencesService>.value(
          value: reminderPrefsService,
        ),
        Provider<ReminderScheduler>.value(value: scheduler),
      ],
      child: RhythmMobileApp(scheduler: scheduler),
    ),
  );
}

class RhythmMobileApp extends StatefulWidget {
  const RhythmMobileApp({super.key, required this.scheduler});

  final ReminderScheduler scheduler;

  @override
  State<RhythmMobileApp> createState() => _RhythmMobileAppState();
}

class _RhythmMobileAppState extends State<RhythmMobileApp>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      widget.scheduler.reschedule();
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Rhythm',
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: AppTheme.system(),
      debugShowCheckedModeBanner: false,
      home: const _RootRouter(),
    );
  }
}

class _RootRouter extends StatelessWidget {
  const _RootRouter();

  @override
  Widget build(BuildContext context) {
    final status = context.watch<AuthSessionService>().status;
    return switch (status) {
      AuthStatus.checking => const SplashScreen(),
      AuthStatus.unauthenticated || AuthStatus.signingIn => const LoginScreen(),
      AuthStatus.authenticated => const AppShell(),
    };
  }
}
