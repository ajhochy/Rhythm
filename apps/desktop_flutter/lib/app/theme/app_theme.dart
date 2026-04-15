import 'package:flutter/material.dart';

import 'rhythm_tokens.dart';

class AppTheme {
  static ThemeData light() => ThemeData(
    useMaterial3: true,
    scaffoldBackgroundColor: RhythmTokens.background,
    colorScheme:
        ColorScheme.fromSeed(
          seedColor: RhythmTokens.accent,
          brightness: Brightness.light,
          surface: RhythmTokens.surface,
          onSurface: RhythmTokens.textPrimary,
          outline: RhythmTokens.border,
        ).copyWith(
          primary: RhythmTokens.accent,
          secondary: RhythmTokens.accentWarm,
          error: RhythmTokens.danger,
          surfaceContainerLow: RhythmTokens.surfaceMuted,
          surfaceContainer: RhythmTokens.surface,
          surfaceContainerHigh: RhythmTokens.surfaceStrong,
        ),
    cardTheme: CardThemeData(
      color: RhythmTokens.surfaceStrong,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
        side: const BorderSide(color: RhythmTokens.border),
      ),
    ),
    dividerColor: RhythmTokens.borderSoft,
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      foregroundColor: RhythmTokens.textPrimary,
    ),
    textTheme: const TextTheme(
      headlineSmall: TextStyle(
        color: RhythmTokens.textPrimary,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.4,
      ),
      titleLarge: TextStyle(
        color: RhythmTokens.textPrimary,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.25,
      ),
      titleMedium: TextStyle(
        color: RhythmTokens.textPrimary,
        fontWeight: FontWeight.w600,
      ),
      bodyMedium: TextStyle(color: RhythmTokens.textPrimary),
      bodySmall: TextStyle(color: RhythmTokens.textSecondary),
      labelLarge: TextStyle(
        color: RhythmTokens.textPrimary,
        fontWeight: FontWeight.w600,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
        borderSide: const BorderSide(color: RhythmTokens.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
        borderSide: const BorderSide(color: RhythmTokens.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
        borderSide: const BorderSide(color: RhythmTokens.accent, width: 2),
      ),
      filled: true,
      fillColor: RhythmTokens.surfaceStrong,
    ),
    chipTheme: ChipThemeData(
      backgroundColor: RhythmTokens.surfaceMuted,
      selectedColor: RhythmTokens.accentSoft,
      labelStyle: const TextStyle(color: RhythmTokens.textPrimary),
      side: const BorderSide(color: RhythmTokens.borderSoft),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
    ),
  );
}
