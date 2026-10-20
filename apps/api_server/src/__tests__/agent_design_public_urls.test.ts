import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { publicAgentDesign } from '../repositories/agent_designs_repository';

// Local designs never expose their file path; they point at the routes that serve them so the
// gallery can show a poster (mp4) or the image itself.
const base = { id: 'd 1', title: 't', provider: 'local', projectUrl: null, canvaUrl: null, sessionId: null, folderId: null, createdAt: '2026-09-28T00:00:00.000Z', artifactUrl: null, thumbnailUrl: null };
const fixtureDir = mkdtempSync(join(tmpdir(), 'rhythm-design-urls-'));
const studio = join(fixtureDir, 'Downloads', 'Rhythm Studio');
beforeAll(() => { mkdirSync(studio, { recursive: true }); vi.stubEnv('HOME', fixtureDir); });
const localFile = (name: string) => {
  const path = join(studio, name);
  writeFileSync(path, 'fixture');
  return path;
};
afterAll(() => { vi.unstubAllEnvs(); rmSync(fixtureDir, { recursive: true, force: true }); });

describe('publicAgentDesign', () => {
  it('does not advertise missing local deliverables or thumbnails', () => {
    const out = publicAgentDesign({ ...base, artifactType: 'mp4', filePath: '/missing/rhythm-studio.mp4' });
    expect(out.artifactUrl).toBeNull();
    expect(out.thumbnailUrl).toBeNull();
    expect(out).not.toHaveProperty('filePath');
  });
  it('preserves independently valid remote URLs on a stale mixed row', () => {
    const out = publicAgentDesign({ ...base, artifactType: 'mp4', filePath: '/missing/rhythm-studio.mp4', artifactUrl: 'https://cdn.example/video.mp4', thumbnailUrl: 'https://cdn.example/poster.png' });
    expect(out.artifactUrl).toBe('https://cdn.example/video.mp4');
    expect(out.thumbnailUrl).toBe('https://cdn.example/poster.png');
  });
  it('does not advertise a local file outside the approved Studio root', () => {
    const outside = join(fixtureDir, 'outside.mp4');
    writeFileSync(outside, 'fixture');
    const out = publicAgentDesign({ ...base, artifactType: 'mp4', filePath: outside });
    expect(out.artifactUrl).toBeNull();
    expect(out.thumbnailUrl).toBeNull();
  });
  it('local mp4: artifact + poster routes, no file path', () => {
    const out = publicAgentDesign({ ...base, artifactType: 'mp4', filePath: localFile('v.mp4') });
    expect(out).not.toHaveProperty('filePath');
    expect(out.artifactUrl).toBe('/agent-designs/d%201/artifact');
    expect(out.thumbnailUrl).toBe('/agent-designs/d%201/thumbnail');
  });
  it('local image: the artifact is its own thumbnail', () => {
    const out = publicAgentDesign({ ...base, artifactType: 'png', filePath: localFile('a.png') });
    expect(out.thumbnailUrl).toBe(out.artifactUrl);
  });
  it('keeps explicit URLs and leaves remote designs untouched', () => {
    expect(publicAgentDesign({ ...base, artifactType: 'mp4', filePath: localFile('explicit.mp4'), thumbnailUrl: 'https://cdn/t.png' }).thumbnailUrl).toBe('https://cdn/t.png');
    const remote = publicAgentDesign({ ...base, artifactType: 'mp4', filePath: null });
    expect(remote.artifactUrl).toBeNull();
    expect(remote.thumbnailUrl).toBeNull();
  });
  it('local PDF has an artifact route but no thumbnail', () => {
    const out = publicAgentDesign({ ...base, artifactType: 'pdf', filePath: localFile('x.pdf') });
    expect(out.artifactUrl).toBe('/agent-designs/d%201/artifact');
    expect(out.thumbnailUrl).toBeNull();
  });
});
