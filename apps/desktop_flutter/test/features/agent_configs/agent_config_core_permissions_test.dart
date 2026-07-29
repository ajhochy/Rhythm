/// Model-level round-trip coverage for #1074 (OCU-33)'s `corePermissionsJson`
/// field. The field is opaque at the model layer (raw JSON object string —
/// parsed/built by the profile sheet), so the unit that actually needs
/// coverage here is `AgentConfig.fromJson`/`toJson`/`copyWith`, not the
/// controller (which passes patches through unchanged).
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/agent_configs/models/agent_config.dart';

void main() {
  group('AgentConfig.corePermissionsJson (#1074)', () {
    test('fromJson reads corePermissionsJson', () {
      final config = AgentConfig.fromJson({
        'id': 'x',
        'label': 'Test',
        'icon': 'terminal',
        'enabled': true,
        'isAgent': true,
        'sortOrder': 0,
        'corePermissionsJson': '{"websearch":"deny"}',
      });

      expect(config.corePermissionsJson, equals('{"websearch":"deny"}'));
    });

    test('fromJson defaults to null when absent', () {
      final config = AgentConfig.fromJson({
        'id': 'x',
        'label': 'Test',
        'icon': 'terminal',
        'enabled': true,
        'isAgent': true,
        'sortOrder': 0,
      });

      expect(config.corePermissionsJson, isNull);
    });

    test('toJson round-trips corePermissionsJson', () {
      final config = AgentConfig(
        id: 'x',
        label: 'Test',
        icon: 'terminal',
        enabled: true,
        isAgent: true,
        sortOrder: 0,
        corePermissionsJson: '{"bash":{"rm *":"ask"}}',
      );

      expect(
        config.toJson()['corePermissionsJson'],
        equals('{"bash":{"rm *":"ask"}}'),
      );
    });

    test(
      'copyWith updates corePermissionsJson without touching other fields',
      () {
        final config = AgentConfig(
          id: 'x',
          label: 'Test',
          icon: 'terminal',
          enabled: true,
          isAgent: true,
          sortOrder: 0,
        );

        final updated = config.copyWith(
          corePermissionsJson: '{"read":"allow"}',
        );

        expect(updated.corePermissionsJson, equals('{"read":"allow"}'));
        expect(updated.label, equals(config.label));
      },
    );

    test('copyWith can clear corePermissionsJson back to null', () {
      final config = AgentConfig(
        id: 'x',
        label: 'Test',
        icon: 'terminal',
        enabled: true,
        isAgent: true,
        sortOrder: 0,
        corePermissionsJson: '{"read":"allow"}',
      );

      final cleared = config.copyWith(corePermissionsJson: null);

      expect(cleared.corePermissionsJson, isNull);
    });
  });
}
