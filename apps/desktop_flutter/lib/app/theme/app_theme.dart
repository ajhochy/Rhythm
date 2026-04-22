import 'package:flutter/material.dart';

import '../core/ui/tokens/rhythm_theme.dart';
import 'rhythm_tokens.dart';

class AppTheme {
  static ThemeMode system() => ThemeMode.system;

  static ThemeData light() => _theme(
        brightness: Brightness.light,
        colors: RhythmColorRoles.light,
      );

  static ThemeData dark() => _theme(
        brightness: Brightness.dark,
        colors: RhythmColorRoles.dark,
      );

  static ThemeData _theme({
    required Brightness brightness,
    required RhythmColorRoles colors,
  }) =>
      ThemeData(
        useMaterial3: true,
        brightness: brightness,
        scaffoldBackgroundColor: colors.canvas,
        colorScheme: ColorScheme.fromSeed(
          seedColor: colors.accent,
          brightness: brightness,
          surface: colors.surface,
          onSurface: colors.textPrimary,
          outline: colors.border,
        ).copyWith(
          primary: colors.accent,
          secondary: colors.warning,
          error: colors.danger,
          surfaceContainerLow: colors.surfaceMuted,
          surfaceContainer: colors.surface,
          surfaceContainerHigh: colors.surfaceRaised,
        ),
        extensions: <ThemeExtension<dynamic>>[colors],
        cardTheme: CardThemeData(
          color: colors.surfaceRaised,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
            side: BorderSide(color: colors.border),
          ),
        ),
        dividerColor: colors.borderSubtle,
        appBarTheme: AppBarTheme(
          backgroundColor: Colors.transparent,
          surfaceTintColor: Colors.transparent,
          elevation: 0,
          centerTitle: false,
          foregroundColor: colors.textPrimary,
        ),
        textTheme: TextTheme(
          headlineSmall: TextStyle(
            color: colors.textPrimary,
            fontWeight: FontWeight.w600,
            letterSpacing: 0,
          ),
          titleLarge: TextStyle(
            color: colors.textPrimary,
            fontWeight: FontWeight.w600,
            letterSpacing: 0,
          ),
          titleMedium: TextStyle(
            color: colors.textPrimary,
            fontWeight: FontWeight.w600,
          ),
          bodyMedium: TextStyle(color: colors.textPrimary),
          bodySmall: TextStyle(color: colors.textSecondary),
          labelLarge: TextStyle(
            color: colors.textPrimary,
            fontWeight: FontWeight.w600,
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
            borderSide: BorderSide(color: colors.border),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
            borderSide: BorderSide(color: colors.border),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
            borderSide: BorderSide(color: colors.focusRing, width: 2),
          ),
          filled: true,
          fillColor: colors.surfaceRaised,
        ),
        chipTheme: ChipThemeData(
          backgroundColor: colors.surfaceMuted,
          selectedColor: colors.accentMuted,
          labelStyle: TextStyle(color: colors.textPrimary),
          side: BorderSide(color: colors.borderSubtle),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
        ),
      );
}
