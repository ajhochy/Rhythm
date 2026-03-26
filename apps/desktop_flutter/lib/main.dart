import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:window_manager/window_manager.dart';

import 'app/core/constants/app_constants.dart';
import 'app/core/layout/app_shell.dart';
import 'app/theme/app_theme.dart';
import 'features/projects/controllers/project_template_controller.dart';
import 'features/projects/data/projects_local_data_source.dart';
import 'features/projects/repositories/projects_repository.dart';
import 'features/integrations/controllers/integrations_controller.dart';
import 'features/integrations/data/integrations_data_source.dart';
import 'features/integrations/repositories/integrations_repository.dart';
import 'features/rhythms/controllers/rhythms_controller.dart';
import 'features/rhythms/data/rhythms_data_source.dart';
import 'features/rhythms/repositories/rhythms_repository.dart';
import 'features/tasks/controllers/tasks_controller.dart';
import 'features/tasks/data/tasks_local_data_source.dart';
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

  runApp(const RhythmApp());
}

class RhythmApp extends StatelessWidget {
  const RhythmApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(
          create: (_) => TasksController(
            TasksRepository(TasksLocalDataSource()),
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => ProjectTemplateController(
            ProjectsRepository(ProjectsLocalDataSource()),
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => RhythmsController(
            RhythmsRepository(RhythmsDataSource()),
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => WeeklyPlannerController(
            WeeklyPlanRepository(WeeklyPlanDataSource()),
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => IntegrationsController(
            IntegrationsRepository(IntegrationsDataSource()),
          ),
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
