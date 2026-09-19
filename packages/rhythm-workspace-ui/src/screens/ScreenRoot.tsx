import type { ReactNode } from 'react';
import { RHYTHM_ROOT_CLASS, mapHostTokens } from '../host/theme';
import { useRhythmHost } from '../context';

export interface ScreenRootProps {
  screenName: string;
  testId: string;
  children: ReactNode;
  /** Escape hatch for a screen-specific data attribute (e.g. the artifacts gate's lock
   * state) that still belongs on the one scoped root element, not a nested wrapper. */
  extraDataAttributes?: Record<string, string>;
}

/** Every screen renders exactly one of these as its outermost element: it is the sole place
 * that (a) applies the `.rhythm-workspace-root` scoping class every stylesheet rule in
 * src/styles/rhythm.css is nested under, (b) maps the host's tokens to this package's own
 * `--rhythm-*` CSS variables, and (c) exposes the host's viewport as `data-rhythm-viewport`
 * so the stylesheet's density rules and the responsive contract test key off one attribute. */
export function ScreenRoot({ screenName, testId, children, extraDataAttributes }: ScreenRootProps) {
  const host = useRhythmHost();
  return (
    <main
      className={RHYTHM_ROOT_CLASS}
      aria-label={screenName}
      data-testid={testId}
      data-rhythm-viewport={host.viewport}
      data-rhythm-theme={host.tokens.mode}
      style={mapHostTokens(host.tokens)}
      {...extraDataAttributes}
    >
      {children}
    </main>
  );
}
