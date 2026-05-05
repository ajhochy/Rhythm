import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app/core/auth/auth_data_source.dart';
import 'app/core/auth/auth_session_service.dart';
import 'app/core/auth/mobile_google_oauth_client.dart';
import 'app/core/layout/app_shell.dart';
import 'app/core/layout/splash_screen.dart';
import 'app/core/services/server_config_service.dart';
import 'app/theme/app_theme.dart';
import 'features/auth/views/login_screen.dart';

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

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<ServerConfigService>.value(value: serverConfig),
        ChangeNotifierProvider<AuthSessionService>.value(value: authSession),
      ],
      child: const RhythmMobileApp(),
    ),
  );
}

class RhythmMobileApp extends StatelessWidget {
  const RhythmMobileApp({super.key});

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
