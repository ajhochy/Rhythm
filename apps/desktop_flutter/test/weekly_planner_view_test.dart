import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/weekly_planner/views/weekly_planner_view.dart';

void main() {
  test('parsePlannerEventDateTime converts UTC timestamps to local time', () {
    final parsed = parsePlannerEventDateTime('2026-04-09T16:20:00.000Z');

    expect(parsed, isNotNull);
    expect(parsed!.isUtc, isFalse);
    expect(parsed.hour, 9);
    expect(parsed.minute, 20);
  });
}
