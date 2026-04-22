import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:window_manager/window_manager.dart';

import 'app/core/constants/app_constants.dart';
import 'app/core/auth/auth_data_source.dart';
import 'app/core/auth/auth_session_service.dart';
import 'app/core/auth/desktop_google_oauth_client.dart';
import 'app/core/layout/app_shell.dart';
import 'app/core/notifications/local_notification_service.dart';
import 'app/core/server/api_server_controller.dart';
import 'app/core/server/api_server_service.dart';
import 'app/core/services/server_config_service.dart';
import 'app/core/services/theme_mode_service.dart';
import 'app/core/updates/update_controller.dart';
import 'app/core/updates/update_service.dart';
import 'app/theme/app_theme.dart';
import 'features/facilities/controllers/facilities_controller.dart';
import 'features/facilities/data/facilities_data_source.dart';
import 'features/facilities/repositories/facilities_repository.dart';
import 'features/integrations/controllers/integrations_controller.dart';
import 'features/integrations/data/integrations_data_source.dart';
import 'features/integrations/repositories/integrations_repository.dart';
import 'features/projects/controllers/project_template_controller.dart';
import 'features/projects/data/projects_local_data_source.dart';
import 'features/projects/repositories/projects_repository.dart';
import 'features/rhythms/controllers/rhythms_controller.dart';
import 'features/rhythms/data/rhythms_data_source.dart';
import 'features/rhythms/repositories/rhythms_repository.dart';
import 'features/tasks/controllers/automation_rules_controller.dart';
import 'features/tasks/controllers/tasks_controller.dart';
import 'features/tasks/data/automation_rules_data_source.dart';
import 'features/tasks/data/tasks_local_data_source.dart';
import 'features/tasks/repositories/automation_rules_repository.dart';
import 'features/tasks/repositories/tasks_repository.dart';
import 'features/dashboard/controllers/dashboard_controller.dart';
import 'features/dashboard/data/dashboard_data_source.dart';
import 'features/dashboard/repositories/dashboard_repository.dart';
import 'features/messages/controllers/messages_controller.dart';
import 'features/messages/data/messages_data_source.dart';
import 'features/messages/repositories/messages_repository.dart';
import 'features/settings/controllers/settings_controller.dart';
import 'features/settings/data/settings_data_source.dart';
import 'features/settings/repositories/settings_repository.dart';
import 'features/weekly_planner/controllers/weekly_planner_controller.dart';
import 'features/weekly_planner/data/weekly_plan_data_source.dart';
import 'features/weekly_planner/repositories/weekly_plan_repository.dart';
import 'app/core/workspace/workspace_controller.dart';
import 'app/core/workspace/workspace_data_source.dart';
import 'app/core/workspace/workspace_repository.dart';
import 'features/notifications/controllers/notifications_controller.dart';
import 'features/notifications/data/notifications_data_source.dart';
import 'features/notifications/repositories/notifications_repository.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await windowManager.ensureInitialized();

  const options = WindowOptions(
    minimumSize: Size(1024, 700),
    size: Size(1440, 900),
    title: AppConstants.appName,
    center: true,
  );
  await windowManager.waitUntilReadyToShow(options, () async {
    await windowManager.show();
    await windowManager.focus();
  });

  // Load persisted server URL and appearance before runApp.
  final serverConfigService = ServerConfigService();
  await serverConfigService.load();
  final themeModeService = ThemeModeService();
  await themeModeService.load();

  // Create the server controller and kick off startup before runApp so the
  // service object is available immediately. The UI shows a loading screen
  // while the server boots.
  final serverController = ApiServerController(
    ApiServerService(),
    serverUrl: serverConfigService.url,
  )..initialize();
  final authSessionService = AuthSessionService(
    AuthDataSource(baseUrl: serverConfigService.url),
    googleClient: DesktopGoogleOAuthClient(baseUrl: serverConfigService.url),
  );
  final localNotificationService = LocalNotificationService();
  await localNotificationService.initialize();

  runApp(
    RhythmApp(
      authSessionService: authSessionService,
      localNotificationService: localNotificationService,
      serverController: serverController,
      serverConfigService: serverConfigService,
      themeModeService: themeModeService,
    ),
  );
}

class RhythmApp extends StatelessWidget {
  const RhythmApp({
    super.key,
    required this.authSessionService,
    required this.localNotificationService,
    required this.serverController,
    required this.serverConfigService,
    required this.themeModeService,
  });

  final AuthSessionService authSessionService;
  final LocalNotificationService localNotificationService;
  final ApiServerController serverController;
  final ServerConfigService serverConfigService;
  final ThemeModeService themeModeService;

  @override
  Widget build(BuildContext context) {
    final baseUrl = serverConfigService.url;
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: serverController),
        ChangeNotifierProvider.value(value: serverConfigService),
        ChangeNotifierProvider.value(value: authSessionService),
        ChangeNotifierProvider.value(value: themeModeService),
        ChangeNotifierProvider(
          create: (_) => TasksController(
            TasksRepository(TasksLocalDataSource(baseUrl: baseUrl)),
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => AutomationRulesController(
            AutomationRulesRepository(
              AutomationRulesDataSource(baseUrl: baseUrl),
            ),
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => ProjectTemplateController(
            ProjectsRepository(ProjectsLocalDataSource(baseUrl: baseUrl)),
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => RhythmsController(
            RhythmsRepository(RhythmsDataSource(baseUrl: baseUrl)),
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => WeeklyPlannerController(
            WeeklyPlanRepository(WeeklyPlanDataSource(baseUrl: baseUrl)),
            TasksRepository(TasksLocalDataSource(baseUrl: baseUrl)),
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => DashboardController(
            DashboardRepository(DashboardDataSource(baseUrl: baseUrl)),
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => FacilitiesController(
            FacilitiesRepository(FacilitiesDataSource(baseUrl: baseUrl)),
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => MessagesController(
            MessagesRepository(MessagesDataSource(baseUrl: baseUrl)),
            notifications: localNotificationService,
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => IntegrationsController(
            IntegrationsRepository(IntegrationsDataSource(baseUrl: baseUrl)),
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => UpdateController(UpdateService())..initialize(),
        ),
        ChangeNotifierProvider(
          create: (_) => SettingsController(
            SettingsRepository(SettingsDataSource(baseUrl: baseUrl)),
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => WorkspaceController(
            WorkspaceRepository(WorkspaceDataSource(baseUrl: baseUrl)),
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => NotificationsController(
            NotificationsRepository(NotificationsDataSource(baseUrl: baseUrl)),
          ),
        ),
      ],
      child: Consumer<ThemeModeService>(
        builder: (_, modeService, __) => MaterialApp(
          title: AppConstants.appName,
          debugShowCheckedModeBanner: false,
          theme: AppTheme.light(),
          darkTheme: AppTheme.dark(),
          themeMode: modeService.themeMode,
          home: const AppShell(),
        ),
      ),
    );
  }
}
