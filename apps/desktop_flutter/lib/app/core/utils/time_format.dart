import 'package:intl/intl.dart';
import 'package:timezone/data/latest.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

const _pacificTimeZoneName = 'America/Los_Angeles';

tz.Location? _pacificTimeZone;

/// Initializes the timezone database used for all displayed timestamps.
void initializeTimestampTimeZone() {
  if (_pacificTimeZone != null) return;
  tz_data.initializeTimeZones();
  _pacificTimeZone = tz.getLocation(_pacificTimeZoneName);
}

/// Formats a UTC or naive timestamp in Pacific time using a 12-hour clock.
///
/// ISO-8601 strings and [DateTime] values without an explicit UTC designator
/// are interpreted as UTC so display output never depends on the device zone.
String formatLocalTimestamp(Object value) {
  final timestamp = switch (value) {
    DateTime dateTime => dateTime,
    String isoTimestamp => DateTime.tryParse(isoTimestamp),
    _ => null,
  };
  if (timestamp == null) return value.toString();

  final utc = timestamp.isUtc
      ? timestamp
      : DateTime.utc(
          timestamp.year,
          timestamp.month,
          timestamp.day,
          timestamp.hour,
          timestamp.minute,
          timestamp.second,
          timestamp.millisecond,
          timestamp.microsecond,
        );
  initializeTimestampTimeZone();
  final pacific = tz.TZDateTime.from(utc, _pacificTimeZone!);
  return DateFormat('MMM d, y h:mm a').format(pacific);
}
