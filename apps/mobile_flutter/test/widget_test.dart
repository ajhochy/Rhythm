import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('Placeholder smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(home: Placeholder()));
    expect(find.byType(Placeholder), findsOneWidget);
  });
}
