import type { RhythmHostTokens } from './types';

/** Every scoped root element carries exactly this class; src/styles/rhythm.css scopes all
 * selectors under it so the package never leaks unprefixed global rules into a host page. */
export const RHYTHM_ROOT_CLASS = 'rhythm-workspace-root';

export const defaultRhythmTokens: RhythmHostTokens = {
  mode: 'dark',
  bg: '#171a1b',
  surface: '#1f2426',
  surfaceRaised: '#262d2f',
  fg: '#f3f6f5',
  fgMuted: '#9fb0ad',
  border: '#4d6260',
  accent: '#4fb8a0',
  accentOn: '#0c1716',
  danger: '#d1584a',
  fontUi: 'Inter, system-ui, sans-serif',
  radiusMd: '16px',
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
    '--rhythm-surface-raised': merged.surfaceRaised,
    '--rhythm-fg': merged.fg,
    '--rhythm-fg-muted': merged.fgMuted,
    '--rhythm-border': merged.border,
    '--rhythm-accent': merged.accent,
    '--rhythm-accent-on': merged.accentOn,
    '--rhythm-danger': merged.danger,
    '--rhythm-font-ui': merged.fontUi,
    '--rhythm-radius-md': merged.radiusMd,
  };
}
