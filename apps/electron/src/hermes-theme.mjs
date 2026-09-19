import { readFileSync } from 'node:fs';

export function loadHermesTheme() {
  return readFileSync(new URL('./hermes-theme.css', import.meta.url), 'utf8');
}
