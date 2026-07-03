import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:rhythm_desktop/app/core/services/default_agent_profile_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('DefaultAgentProfileService.load', () {
    test('defaultOcAgent is null when nothing saved', () async {
      final svc = DefaultAgentProfileService();
      await svc.load();

      expect(svc.defaultOcAgent, isNull);
    });

    test('a previously saved setting is read back on load', () async {
      SharedPreferences.setMockInitialValues({
        'default_agent_ocagent': 'theologian',
      });
      final svc = DefaultAgentProfileService();
      await svc.load();

      expect(svc.defaultOcAgent, 'theologian');
    });
  });

  group('DefaultAgentProfileService.setDefault', () {
    test('persists the chosen ocAgent and updates the getter', () async {
      final svc = DefaultAgentProfileService();
      await svc.load();

      await svc.setDefault('theologian');

      expect(svc.defaultOcAgent, 'theologian');

      // A freshly constructed service should read the persisted value back.
      final reloaded = DefaultAgentProfileService();
      await reloaded.load();
      expect(reloaded.defaultOcAgent, 'theologian');
    });

    test('notifies listeners when the value changes', () async {
      final svc = DefaultAgentProfileService();
      await svc.load();

      var notified = 0;
      svc.addListener(() => notified++);

      await svc.setDefault('claude-code');

      expect(notified, 1);
    });

    test('does not notify listeners when set to the same value', () async {
      final svc = DefaultAgentProfileService();
      await svc.load();
      await svc.setDefault('claude-code');

      var notified = 0;
      svc.addListener(() => notified++);

      await svc.setDefault('claude-code');

      expect(notified, 0);
    });

    test('setting null clears the persisted override', () async {
      final svc = DefaultAgentProfileService();
      await svc.load();
      await svc.setDefault('theologian');

      await svc.setDefault(null);

      expect(svc.defaultOcAgent, isNull);

      final reloaded = DefaultAgentProfileService();
      await reloaded.load();
      expect(reloaded.defaultOcAgent, isNull);
    });
  });
}
