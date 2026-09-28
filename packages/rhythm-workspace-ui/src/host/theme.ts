import type { RhythmHostTokens } from './types';

/** Every scoped root element carries exactly this class; src/styles/rhythm.css scopes all
 * selectors under it so the package never leaks unprefixed global rules into a host page. */
export const RHYTHM_ROOT_CLASS = 'rhythm-workspace-root';

export const defaultRhythmTokens: RhythmHostTokens = {
  mode: 'dark',
  bg: '#171a1b',
  surface: '#1f2426',
  surfaceWarm: '#283230',
  surfaceRaised: '#262d2f',
  fg: '#f3f6f5',
  fgSecondary: '#c7d6d3',
  fgMuted: '#9fb0ad',
  border: '#4d6260',
  borderSoft: '#33403e',
  accent: '#4fb8a0',
  accentOn: '#0c1716',
  accentHover: '#469e8a',
  success: '#5fbf83',
  warning: '#d1a24f',
  danger: '#d1584a',
  info: '#5a9fd1',
  fontUi: 'Inter, system-ui, sans-serif',
  fontMono: '"SF Mono", ui-monospace, Menlo, monospace',
  radiusSm: '10px',
  radiusMd: '16px',
  radiusLg: '24px',
  radiusPill: '999px',
  focusRing: '0 0 0 4px rgba(79, 184, 160, 0.32)',
  shadow: '0 24px 80px rgba(10, 14, 13, 0.4)',
};

/** Maps a host's design tokens onto this package's own `--rhythm-*` CSS variable
 * vocabulary, applied as an inline style on the scoped root. Never reads or writes an
 * unprefixed/global custom property (e.g. `--bg`, `--fg`) — a host may have its own,
 * unrelated variables under those names, and colliding with them was the reason M1 exists. */
export function mapHostTokens(tokens: Partial<RhythmHostTokens> | undefined): Record<string, string> {
  const merged: RhythmHostTokens = { ...defaultRhythmTokens, ...tokens };
  return {
    '--rhythm-bg': merged.bg,
    '--rhythm-surface': merged.surface,
    '--rhythm-surface-warm': merged.surfaceWarm,
    '--rhythm-surface-raised': merged.surfaceRaised,
    '--rhythm-fg': merged.fg,
    '--rhythm-fg-secondary': merged.fgSecondary,
    '--rhythm-fg-muted': merged.fgMuted,
    '--rhythm-border': merged.border,
    '--rhythm-border-soft': merged.borderSoft,
    '--rhythm-accent': merged.accent,
    '--rhythm-accent-on': merged.accentOn,
    '--rhythm-accent-hover': merged.accentHover,
    '--rhythm-success': merged.success,
    '--rhythm-warning': merged.warning,
    '--rhythm-danger': merged.danger,
    '--rhythm-info': merged.info,
    '--rhythm-font-ui': merged.fontUi,
    '--rhythm-font-mono': merged.fontMono,
    '--rhythm-radius-sm': merged.radiusSm,
    '--rhythm-radius-md': merged.radiusMd,
    '--rhythm-radius-lg': merged.radiusLg,
    '--rhythm-radius-pill': merged.radiusPill,
    '--rhythm-focus': merged.focusRing,
    '--rhythm-shadow': merged.shadow,
  };
}
