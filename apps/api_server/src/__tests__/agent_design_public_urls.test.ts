import { describe, expect, it } from 'vitest';

import { publicAgentDesign } from '../repositories/agent_designs_repository';

// Local designs never expose their file path; they point at the routes that serve them so the
// gallery can show a poster (mp4) or the image itself.
const base = { id: 'd 1', title: 't', provider: 'local', projectUrl: null, canvaUrl: null, sessionId: null, createdAt: '2026-09-28T00:00:00.000Z', artifactUrl: null, thumbnailUrl: null };

describe('publicAgentDesign', () => {
  it('local mp4: artifact + poster routes, no file path', () => {
    const out = publicAgentDesign({ ...base, artifactType: 'mp4', filePath: '/Users/x/v.mp4' });
    expect(out).not.toHaveProperty('filePath');
    expect(out.artifactUrl).toBe('/agent-designs/d%201/artifact');
    expect(out.thumbnailUrl).toBe('/agent-designs/d%201/thumbnail');
  });
  it('local image: the artifact is its own thumbnail', () => {
    const out = publicAgentDesign({ ...base, artifactType: 'png', filePath: '/Users/x/a.png' });
    expect(out.thumbnailUrl).toBe(out.artifactUrl);
  });
  it('keeps explicit URLs and leaves remote designs untouched', () => {
    expect(publicAgentDesign({ ...base, artifactType: 'mp4', filePath: '/x.mp4', thumbnailUrl: 'https://cdn/t.png' }).thumbnailUrl).toBe('https://cdn/t.png');
    const remote = publicAgentDesign({ ...base, artifactType: 'mp4', filePath: null });
    expect(remote.artifactUrl).toBeNull();
    expect(remote.thumbnailUrl).toBeNull();
  });
  it('local html has an artifact route but no thumbnail', () => {
    const out = publicAgentDesign({ ...base, artifactType: 'html', filePath: '/x.html' });
    expect(out.artifactUrl).toBe('/agent-designs/d%201/artifact');
    expect(out.thumbnailUrl).toBeNull();
  });
});
