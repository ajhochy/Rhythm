import { createElement, type ComponentType } from 'react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { AutomationsScreen, FacilitiesScreen, IntegrationsScreen, ProjectsScreen, RhythmWorkspaceProvider } from '../src/index';
import { defaultRhythmTokens } from '../src/host/theme';
import { fixtureDomainGateway } from './test-utils/fixtures';
import { actClick, actKeyDown, flush, mount } from './test-utils/mount';

const screens: Array<[string, ComponentType]> = [
  ['projects', ProjectsScreen],
  ['facilities', FacilitiesScreen],
  ['automations', AutomationsScreen],
  ['integrations', IntegrationsScreen],
];

function render(Screen: ComponentType, viewport: 'compact' | 'regular', mode: 'light' | 'dark') {
  return mount(createElement(RhythmWorkspaceProvider, {
    gateway: fixtureDomainGateway(),
    host: {
      tokens: { ...defaultRhythmTokens, mode },
      viewport,
      currentUser: {
        id: 'parity-user', displayName: 'Parity User', initials: 'PU', collaborationCapability: 'write',
        capabilities: ['projects.write', 'facilities.manage', 'facilities.reserve', 'automations.write', 'integrations.write'],
      },
    },
    children: createElement(Screen),
  }));
}

describe.each(screens)('issue #1540 P3 %s ListInspector parity', (screenName, Screen) => {
  it(`issue-1540-P3-${screenName}: renders compact/wide, supports keyboard selection, themes, and has zero axe violations`, async () => {
    for (const viewport of ['compact', 'regular'] as const) {
      for (const mode of ['light', 'dark'] as const) {
        const mounted = render(Screen, viewport, mode);
        try {
          await flush();
          const listbox = mounted.container.querySelector<HTMLElement>('.list-inspector-list[role="listbox"]');
          expect(listbox).toBeTruthy();
          const first = listbox!.querySelector<HTMLElement>('[role="option"]');
          expect(first).toBeTruthy();
          await actKeyDown(first!, 'Enter');
          await flush();
          expect(first!.getAttribute('aria-selected')).toBe('true');
          if (viewport === 'compact') {
            const back = mounted.container.querySelector<HTMLElement>('.list-inspector-back')!;
            expect(back).toBeTruthy();
            await actClick(back);
            await flush();
            expect(document.activeElement).toBe(first);
          } else {
            expect(mounted.container.querySelector('[role="separator"]')).toBeTruthy();
          }
          expect(mounted.container.querySelector('.rhythm-workspace-root')?.getAttribute('data-rhythm-theme')).toBe(mode);
          const results = await axe.run(mounted.container, { rules: { 'color-contrast': { enabled: false } } });
          expect(results.violations, results.violations.map((item) => item.id).join(', ')).toEqual([]);
        } finally {
          mounted.unmount();
        }
      }
    }
  });
});
