import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:rhythm_desktop/app/core/services/memory_vault_config_service.dart';
import 'package:rhythm_desktop/features/settings/views/settings_view.dart';

Widget _wrap(MemoryVaultConfigService service) {
  return ChangeNotifierProvider<MemoryVaultConfigService>.value(
    value: service,
    child: const MaterialApp(
      home: Scaffold(body: SingleChildScrollView(child: MemoryVaultSection())),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('shows the current Memory Vault path from the service',
      (tester) async {
    final service = MemoryVaultConfigService(
      directoryExists: (path) => path.endsWith('AGENT-MEMORY'),
    );
    await service.load();

    await tester.pumpWidget(_wrap(service));
    await tester.pumpAndSettle();

    expect(find.text('Memory Vault path'), findsOneWidget);
    final field = tester.widget<TextFormField>(find.byType(TextFormField));
    expect(
      field.controller?.text,
      MemoryVaultConfigService.obsidianVaultPath,
    );
    expect(find.textContaining('Resolved: '), findsOneWidget);
  });

  testWidgets('falls back to the legacy vault path when Obsidian vault absent',
      (tester) async {
    final service = MemoryVaultConfigService(directoryExists: (_) => false);
    await service.load();

    await tester.pumpWidget(_wrap(service));
    await tester.pumpAndSettle();

    final field = tester.widget<TextFormField>(find.byType(TextFormField));
    expect(
      field.controller?.text,
      MemoryVaultConfigService.legacyDefaultPath,
    );
  });

  testWidgets('editing and saving persists the new path', (tester) async {
    final service = MemoryVaultConfigService(directoryExists: (_) => false);
    await service.load();

    await tester.pumpWidget(_wrap(service));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextFormField), '/custom/vault/path');
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();

    expect(service.path, '/custom/vault/path');
    expect(find.textContaining('Saved.'), findsOneWidget);
  });
}
