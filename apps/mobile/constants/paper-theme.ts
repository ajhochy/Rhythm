import {
  MD3DarkTheme,
  MD3LightTheme,
  type MD3Theme,
} from 'react-native-paper';

import { Colors } from '@/constants/theme';

export function getPaperTheme(colorScheme: 'light' | 'dark'): MD3Theme {
  const palette = Colors[colorScheme];
  const base = colorScheme === 'dark' ? MD3DarkTheme : MD3LightTheme;

  return {
    ...base,
    roundness: 2.5,
    colors: {
      ...base.colors,
      primary: palette.tint,
      onPrimary: colorScheme === 'dark' ? palette.background : palette.surface,
      primaryContainer: palette.surfaceAlt,
      onPrimaryContainer: palette.text,
      secondary: palette.accent,
      onSecondary: colorScheme === 'dark' ? palette.background : palette.surface,
      secondaryContainer: palette.surfaceAlt,
      onSecondaryContainer: palette.text,
      error: palette.danger,
      background: palette.background,
      onBackground: palette.text,
      surface: palette.surface,
      onSurface: palette.text,
      surfaceVariant: palette.surfaceAlt,
      onSurfaceVariant: palette.muted,
      outline: palette.border,
      outlineVariant: palette.border,
      elevation: {
        ...base.colors.elevation,
        level0: palette.background,
        level1: palette.surface,
        level2: palette.surfaceAlt,
        level3: palette.card,
        level4: palette.card,
        level5: palette.card,
      },
    },
  };
}
