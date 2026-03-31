import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:window_manager/window_manager.dart';

import 'app/core/constants/app_constants.dart';
import 'app/core/layout/app_shell.dart';
import 'app/core/server/api_server_controller.dart';
import 'app/core/server/api_server_service.dart';
import 'app/core/services/server_config_service.dart';
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
import 'features/weekly_planner/controllers/weekly_planner_controller.dart';
import 'features/weekly_planner/data/weekly_plan_data_source.dart';
import 'features/weekly_planner/repositories/weekly_plan_repository.dart';

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

  // Load persisted server URL before runApp.
  final serverConfigService = ServerConfigService();
  await serverConfigService.load();

  // Create the server controller and kick off startup before runApp so the
  // service object is available immediately. The UI shows a loading screen
  // while the server boots.
  final serverController = ApiServerController(ApiServerService())
    ..initialize();

  runApp(RhythmApp(
    serverController: serverController,
    serverConfigService: serverConfigService,
  ));
}

class RhythmApp extends StatelessWidget {
  const RhythmApp({
    super.key,
    required this.serverController,
    required this.serverConfigService,
  });

  final ApiServerController serverController;
  final ServerConfigService serverConfigService;

  @override
  Widget build(BuildContext context) {
    final baseUrl = serverConfigService.url;
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: serverController),
        ChangeNotifierProvider.value(value: serverConfigService),
        ChangeNotifierProvider(
          create: (_) => TasksController(
            TasksRepository(TasksLocalDataSource(baseUrl: baseUrl)),
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => AutomationRulesController(
            AutomationRulesRepository(
                AutomationRulesDataSource(baseUrl: baseUrl)),
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
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => FacilitiesController(
            FacilitiesRepository(FacilitiesDataSource(baseUrl: baseUrl)),
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
      ],
      child: MaterialApp(
        title: AppConstants.appName,
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light(),
        home: const AppShell(),
      ),
    );
  }
}
