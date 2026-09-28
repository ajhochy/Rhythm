import { Platform } from 'react-native';

// Fixed sRGB conversions of the approved OKLch brand tokens.
const tintColorLight = '#007760';
const tintColorDark = '#42C3A6';

export const Colors = {
  light: {
    text: '#1B1F1E',
    background: '#F4F8F6',
    surface: '#FCFEFD',
    surfaceAlt: '#EBF1EF',
    card: '#EBF1EF',
    tint: tintColorLight,
    accent: tintColorLight,
    muted: '#5E6965',
    border: '#B7C2BF',
    icon: '#5E6965',
    success: '#147D64',
    warning: '#9D640C',
    danger: '#B64545',
    bubbleUser: tintColorLight,
    onBubbleUser: '#FCFEFD',
    bubbleAssistant: '#EBF1EF',
    onBubbleAssistant: '#1B1F1E',
    tabBackground: '#FCFEFD',
    tabIconDefault: '#5E6965',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#DCDFDE',
    background: '#222524',
    surface: '#282D2C',
    surfaceAlt: '#2E3634',
    card: '#333D3A',
    tint: tintColorDark,
    accent: tintColorDark,
    muted: '#9DA7A4',
    border: '#5B6C67',
    icon: '#9DA7A4',
    success: '#63D9B1',
    warning: '#E6B35A',
    danger: '#F08A8A',
    bubbleUser: tintColorDark,
    onBubbleUser: '#222524',
    bubbleAssistant: '#2E3634',
    onBubbleAssistant: '#DCDFDE',
    tabBackground: '#282D2C',
    tabIconDefault: '#9DA7A4',
    tabIconSelected: tintColorDark,
  },
};

export const Spacing = {
  x1: 4,
  x2: 8,
  x3: 12,
  x4: 16,
  x6: 24,
  x8: 32,
} as const;

export const TypeScale = {
  largeTitle: 34,
  title1: 28,
  title2: 22,
  title3: 20,
  body: 17,
  callout: 16,
  subheadline: 15,
  secondary: 15,
  footnote: 13,
  meta: 13,
  caption: 12,
  caption2: 11,
} as const;

export const Radii = {
  small: 10,
  control: 10,
  grouped: 16,
  sheet: 24,
  pill: 9999,
} as const;

export const MinimumTouchTarget = 44;

export const Fonts = Platform.select({
  ios: {
    sans: 'System',
    serif: 'System',
    rounded: 'System',
    mono: 'SFMono-Regular',
    display: 'System',
  },
  default: {
    sans: 'normal',
    serif: 'normal',
    rounded: 'normal',
    mono: 'monospace',
    display: 'normal',
  },
  web: {
    sans: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif",
    serif: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif",
    rounded: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    display: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif",
  },
});
