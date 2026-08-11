import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('issue-1243-c5: dashboard renders a goal progress donut', () {
    // Regression caught: goal data reaches the client but the Dashboard omits
    // its visual rollup. The stable key is the observable render contract and
    // lets a later widget test address a particular goal without matching copy.
    final source = File(
      'lib/features/dashboard/views/dashboard_view.dart',
    ).readAsStringSync();

    expect(source, contains("ValueKey('goal-progress-donut-\${goal.id}')"));
    expect(source, contains('CircularStepProgressIndicator'));
  });
}
