import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('AV-04 Dashboard shell declares the fixed artifact tab toolbar', () {
    // Regression: Dashboard remains a bare body and users have no stable place
    // to restore, focus, or close their per-user artifact tabs.
    final shell = File('lib/app/core/layout/app_shell.dart').readAsStringSync();
    expect(shell, contains('DashboardArtifactTabs'));
    expect(shell, contains('LiveArtifactsController'));
  });
}
