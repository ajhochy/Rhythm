import 'package:flutter/material.dart';

/// Returns `true` if [when] falls within the quiet-hours window defined by
/// [start] and [end].
///
/// Handles both same-day windows (e.g. 12:00–14:00) **and** windows that wrap
/// past midnight (e.g. 22:00–07:00).
///
/// A [when] time that equals exactly [start] is considered inside the window
/// (inclusive start, exclusive end).
bool isInQuietHours(DateTime when, TimeOfDay start, TimeOfDay end) {
  // Express everything in minutes since midnight for easy comparison.
  final whenMinutes = when.hour * 60 + when.minute;
  final startMinutes = start.hour * 60 + start.minute;
  final endMinutes = end.hour * 60 + end.minute;

  if (startMinutes == endMinutes) {
    // Zero-length window — nothing is quiet.
    return false;
  }

  if (startMinutes < endMinutes) {
    // Non-wrapping window: e.g. 12:00–14:00.
    return whenMinutes >= startMinutes && whenMinutes < endMinutes;
  } else {
    // Wrapping window: e.g. 22:00–07:00 spans midnight.
    // "Inside" means after start OR before end.
    return whenMinutes >= startMinutes || whenMinutes < endMinutes;
  }
}
