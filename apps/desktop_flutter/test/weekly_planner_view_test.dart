import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/weekly_planner/views/weekly_planner_view.dart';

void main() {
  test('parsePlannerEventDateTime converts UTC timestamps to local time', () {
    const raw = '2026-04-09T16:20:00.000Z';
    final parsed = parsePlannerEventDateTime(raw);
    final expected = DateTime.parse(raw).toLocal();

    expect(parsed, isNotNull);
    expect(parsed!.isUtc, isFalse);
    expect(parsed.year, expected.year);
    expect(parsed.month, expected.month);
    expect(parsed.day, expected.day);
    expect(parsed.hour, expected.hour);
    expect(parsed.minute, expected.minute);
  });
}
