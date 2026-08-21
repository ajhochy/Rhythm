import type { ComponentType } from 'react';
import { createElement } from 'react';
import axe from 'axe-core';
import { RhythmWorkspaceProvider } from '../../src/context';
import { defaultRhythmTokens } from '../../src/host/theme';
import type { RhythmDomainGateway } from '../../src/domain/types';
import type { RhythmHostAdapter } from '../../src/host/types';
import { mount, flush } from './mount';

export interface ScreenContractCase {
  Screen: ComponentType;
  screenName: string;
  testId: string;
  gateway: RhythmDomainGateway;
}

function buildHost(overrides: Partial<RhythmHostAdapter> = {}): RhythmHostAdapter {
  return {
    tokens: defaultRhythmTokens,
    viewport: 'regular',
    currentUser: { displayName: 'AJ Hochhalter', initials: 'AH' },
    ...overrides,
  };
}

/** Shared assertion set every non-agent screen must satisfy: page contract, focus contract,
 * responsive contract, theme contract, and accessibility contract. Each screen's own test
 * file calls this once with its fixture gateway — the vertical slice is "screen X satisfies
 * the workspace contract," not "screen X has 40 hand-duplicated assertions." */
export async function assertScreenContract({ Screen, screenName, testId, gateway }: ScreenContractCase) {
  const bodyFocusedBefore = document.activeElement;

  // --- page contract ---
  const regular = mount(
    createElement(RhythmWorkspaceProvider, { gateway, host: buildHost(), children: createElement(Screen) }),
  );
  await flush();
  const root = regular.byTestId(testId);
  if (!root) throw new Error(`expected screen root [data-testid="${testId}"] to render`);
  if (root.getAttribute('aria-label') !== screenName) {
    throw new Error(`expected root aria-label "${screenName}", got "${root.getAttribute('aria-label')}"`);
  }
  const headings = root.querySelectorAll('h1');
  if (headings.length !== 1) throw new Error(`expected exactly one <h1>, found ${headings.length}`);

  // --- focus contract: mounting must never steal focus from the host page ---
  if (document.activeElement !== bodyFocusedBefore) {
    throw new Error('mounting a screen must not move focus away from the host document');
  }

  // --- theme contract: default tokens map onto the scoped root, no host tokens required ---
  if (root.style.getPropertyValue('--rhythm-accent') !== defaultRhythmTokens.accent) {
    throw new Error('expected default theme tokens to be applied to the scoped root');
  }
  regular.unmount();

  // custom tokens actually flow through
  const customAccent = '#ff00aa';
  const themed = mount(
    createElement(RhythmWorkspaceProvider, {
      gateway,
      host: buildHost({ tokens: { ...defaultRhythmTokens, accent: customAccent } }),
      children: createElement(Screen),
    }),
  );
  await flush();
  const themedRoot = themed.byTestId(testId);
  if (!themedRoot || themedRoot.style.getPropertyValue('--rhythm-accent') !== customAccent) {
    throw new Error('expected a host-supplied accent token to override the default');
  }
  themed.unmount();

  // --- responsive contract: viewport flows through to a single data attribute ---
  const compact = mount(
    createElement(RhythmWorkspaceProvider, {
      gateway,
      host: buildHost({ viewport: 'compact' }),
      children: createElement(Screen),
    }),
  );
  await flush();
  const compactRoot = compact.byTestId(testId);
  if (compactRoot?.getAttribute('data-rhythm-viewport') !== 'compact') {
    throw new Error('expected data-rhythm-viewport to reflect the host-supplied viewport');
  }
  compact.unmount();

  // --- accessibility contract ---
  const a11y = mount(
    createElement(RhythmWorkspaceProvider, { gateway, host: buildHost(), children: createElement(Screen) }),
  );
  await flush();
  const results = await axe.run(a11y.container, { rules: { 'color-contrast': { enabled: false } } });
  if (results.violations.length > 0) {
    const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}`).join('; ');
    throw new Error(`expected zero axe violations, found ${results.violations.length}: ${summary}`);
  }
  a11y.unmount();
}
