import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { ArtifactsScreen } from '../../src/artifacts/ArtifactsScreen';
import { RhythmWorkspaceProvider } from '../../src/context';
import { defaultRhythmTokens } from '../../src/host/theme';
import { fixtureDomainGateway } from '../test-utils/fixtures';
import { actClick, flush, mount } from '../test-utils/mount';

const host = { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { displayName: 'AJ', initials: 'AH' } };

describe('issue-11: ArtifactHostPort', () => {
  it('renders compact and expanded host layouts with an explicit bounded failure state', async () => {
    for (const viewport of ['compact', 'expanded'] as const) {
      const mounted = mount(createElement(RhythmWorkspaceProvider, {
        gateway: fixtureDomainGateway(), host: { ...host, viewport },
        children: createElement(ArtifactsScreen, { artifactsGateway: { list: async () => { throw new Error('bounded fixture failure'); } } }),
      }));
      await flush();
      expect(mounted.byTestId('rhythm-artifacts-screen')?.getAttribute('data-rhythm-viewport')).toBe(viewport);
      expect(mounted.byTestId('rhythm-artifacts-error')?.getAttribute('role')).toBe('alert');
      expect(mounted.byTestId('rhythm-artifacts-screen')?.textContent).not.toContain('bounded fixture failure');
      mounted.unmount();
    }
  });

  it('mounts the host-sanitized document in an opaque-origin, no-network iframe', async () => {
    const receive = vi.fn(async () => ({ status: 'ok' as const, payload: { value: 'current' } }));
    const mounted = mount(createElement(RhythmWorkspaceProvider, {
      gateway: fixtureDomainGateway(), host,
      children: createElement(ArtifactsScreen, {
        artifactsGateway: { list: async () => [{ id: 'calendar', title: 'Worship calendar', kind: 'document' as const }] },
        artifactHostPort: {
          open: async () => ({ artifactId: 'calendar', sessionId: 'session-1', bundleGeneration: 'bundle-4', stateGeneration: 'state-7', bodyHtml: '<main>Calendar</main>', styleText: 'main{color:green}', scriptText: '', capabilities: ['state.get'] as const }),
          receive,
        },
      }),
    }));
    await flush();
    await actClick(mounted.byTestId('rhythm-artifact-open-calendar')!);
    await flush();

    const frame = mounted.byTestId('rhythm-artifact-frame') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.srcdoc).toContain("default-src 'none'");
    expect(frame.srcdoc).toContain("connect-src 'none'");
    expect(frame.srcdoc).toContain("form-action 'none'");
    expect(frame.srcdoc).toContain("base-uri 'none'");
    expect(frame.srcdoc).toContain("frame-src 'none'");
    expect(frame.srcdoc).toContain("object-src 'none'");
    expect(frame.srcdoc).toContain("navigate-to 'none'");
    expect(frame.srcdoc).toContain('style-src \'nonce-');
    expect(frame.srcdoc).toContain('script-src \'nonce-');
    expect(frame.srcdoc).not.toContain("'unsafe-inline'");
    expect(frame.srcdoc).toContain('Calendar');
    expect(frame.srcdoc).not.toContain('fetch(');

    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow!, data: {
      type: 'rhythm-artifact-capability', requestId: 'request-1', frameId: frame.dataset.frameId,
      artifactId: 'calendar', sessionId: 'session-1', bundleGeneration: 'bundle-4', stateGeneration: 'state-7', capability: 'state.get', payload: {},
    }, origin: 'null' }));
    await flush();
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      frameId: frame.dataset.frameId,
      artifactId: 'calendar',
      sessionId: 'session-1',
      bundleGeneration: 'bundle-4',
      stateGeneration: 'state-7',
      capability: 'state.get',
    }));
    mounted.unmount();
  });

  it('rejects stale, unknown, and foreign-frame capability messages before the host receives them', async () => {
    const receive = vi.fn(async () => ({ status: 'ok' as const }));
    const mounted = mount(createElement(RhythmWorkspaceProvider, {
      gateway: fixtureDomainGateway(), host,
      children: createElement(ArtifactsScreen, {
        artifactsGateway: { list: async () => [{ id: 'calendar', title: 'Worship calendar', kind: 'document' as const }] },
        artifactHostPort: {
          open: async () => ({ artifactId: 'calendar', sessionId: 'session-1', bundleGeneration: 'bundle-4', stateGeneration: 'state-7', bodyHtml: '', styleText: '', scriptText: '', capabilities: ['state.get'] as const }),
          receive,
        },
      }),
    }));
    await flush(); await actClick(mounted.byTestId('rhythm-artifact-open-calendar')!); await flush();
    const frame = mounted.byTestId('rhythm-artifact-frame') as HTMLIFrameElement;
    const base = { type: 'rhythm-artifact-capability', requestId: 'request-1', frameId: frame.dataset.frameId, artifactId: 'calendar', sessionId: 'session-1', bundleGeneration: 'bundle-4', stateGeneration: 'state-7', capability: 'state.get', payload: {} };
    for (const data of [{ ...base, stateGeneration: 'state-older' }, { ...base, capability: 'calendar.write' }, { ...base, frameId: 'another-frame' }]) {
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow!, data, origin: 'null' }));
    }
    window.dispatchEvent(new MessageEvent('message', { source: window, data: base, origin: 'null' }));
    await flush();
    expect(receive).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it('rejects wrong origins and replayed request ids before the host receives them', async () => {
    const receive = vi.fn(async () => ({ status: 'ok' as const }));
    const mounted = mount(createElement(RhythmWorkspaceProvider, {
      gateway: fixtureDomainGateway(), host,
      children: createElement(ArtifactsScreen, {
        artifactsGateway: { list: async () => [{ id: 'calendar', title: 'Worship calendar', kind: 'document' as const }] },
        artifactHostPort: {
          open: async () => ({ artifactId: 'calendar', sessionId: 'session-1', bundleGeneration: 'bundle-4', stateGeneration: 'state-7', bodyHtml: '', styleText: '', scriptText: '', capabilities: ['state.get'] as const }),
          receive,
        },
      }),
    }));
    await flush(); await actClick(mounted.byTestId('rhythm-artifact-open-calendar')!); await flush();
    const frame = mounted.byTestId('rhythm-artifact-frame') as HTMLIFrameElement;
    const data = { type: 'rhythm-artifact-capability', requestId: 'request-1', frameId: frame.dataset.frameId, artifactId: 'calendar', sessionId: 'session-1', bundleGeneration: 'bundle-4', stateGeneration: 'state-7', capability: 'state.get', payload: {} };
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow!, data, origin: 'https://untrusted.example' }));
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow!, data, origin: 'null' }));
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow!, data, origin: 'null' }));
    await flush();
    expect(receive).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });
});
