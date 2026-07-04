import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerGithubIssueTools } from './githubIssues';

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: true;
}>;

class FakeServer {
  registered = new Map<string, ToolHandler>();

  tool(name: string, _description: string, _schema: unknown, handler: ToolHandler) {
    this.registered.set(name, handler);
  }
}

const ORIGINAL_ENV = { ...process.env };

describe('rhythm_create_issue MCP tool', () => {
  beforeEach(() => {
    delete process.env.RHYTHM_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.RHYTHM_GITHUB_REPO;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('registers the rhythm_create_issue tool', () => {
    const server = new FakeServer();
    registerGithubIssueTools(server as never);
    expect(server.registered.has('rhythm_create_issue')).toBe(true);
  });

  it('happy path: posts to the GitHub REST API and returns issue number + url', async () => {
    process.env.RHYTHM_GITHUB_TOKEN = 'gh-token-123';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ number: 42, html_url: 'https://github.com/ajhochy/Rhythm/issues/42' }),
      text: async () => '',
    });

    const server = new FakeServer();
    registerGithubIssueTools(server as never, fetchMock as never);

    const handler = server.registered.get('rhythm_create_issue')!;
    const response = await handler({
      title: 'Add dark mode',
      body: 'Users want a dark theme.',
      labels: ['enhancement'],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/ajhochy/Rhythm/issues',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer gh-token-123',
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          title: 'Add dark mode',
          body: 'Users want a dark theme.',
          labels: ['enhancement'],
        }),
      }),
    );

    expect(response.isError).toBeUndefined();
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed).toEqual({ number: 42, url: 'https://github.com/ajhochy/Rhythm/issues/42' });
  });

  it('falls back to GITHUB_TOKEN when RHYTHM_GITHUB_TOKEN is unset', async () => {
    process.env.GITHUB_TOKEN = 'fallback-token';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ number: 1, html_url: 'https://github.com/ajhochy/Rhythm/issues/1' }),
      text: async () => '',
    });

    const server = new FakeServer();
    registerGithubIssueTools(server as never, fetchMock as never);

    const handler = server.registered.get('rhythm_create_issue')!;
    await handler({ title: 'Minimal issue' });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fallback-token' }),
      }),
    );
  });

  it('respects RHYTHM_GITHUB_REPO override', async () => {
    process.env.RHYTHM_GITHUB_TOKEN = 'tok';
    process.env.RHYTHM_GITHUB_REPO = 'someorg/other-repo';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ number: 1, html_url: 'https://github.com/someorg/other-repo/issues/1' }),
      text: async () => '',
    });

    const server = new FakeServer();
    registerGithubIssueTools(server as never, fetchMock as never);

    const handler = server.registered.get('rhythm_create_issue')!;
    await handler({ title: 'Repo override test' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/someorg/other-repo/issues',
      expect.anything(),
    );
  });

  it('missing-token error: returns a clear error, never a hallucinated success', async () => {
    const fetchMock = vi.fn();
    const server = new FakeServer();
    registerGithubIssueTools(server as never, fetchMock as never);

    const handler = server.registered.get('rhythm_create_issue')!;
    const response = await handler({ title: 'Should fail' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('GitHub token not configured');
  });

  it('title validation: rejects an empty (or whitespace-only) title without calling fetch', async () => {
    process.env.RHYTHM_GITHUB_TOKEN = 'tok';
    const fetchMock = vi.fn();
    const server = new FakeServer();
    registerGithubIssueTools(server as never, fetchMock as never);

    const handler = server.registered.get('rhythm_create_issue')!;
    const response = await handler({ title: '   ' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.isError).toBe(true);
    expect(response.content[0].text.toLowerCase()).toContain('title');
  });

  it('rejects an oversized body without calling fetch', async () => {
    process.env.RHYTHM_GITHUB_TOKEN = 'tok';
    const fetchMock = vi.fn();
    const server = new FakeServer();
    registerGithubIssueTools(server as never, fetchMock as never);

    const handler = server.registered.get('rhythm_create_issue')!;
    const response = await handler({ title: 'Fine title', body: 'x'.repeat(70_000) });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.isError).toBe(true);
    expect(response.content[0].text.toLowerCase()).toContain('too large');
  });

  it('GitHub 4xx surfaces as a tool error, not a success', async () => {
    process.env.RHYTHM_GITHUB_TOKEN = 'tok';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ message: 'Validation Failed' }),
      text: async () => 'Validation Failed',
    });

    const server = new FakeServer();
    registerGithubIssueTools(server as never, fetchMock as never);

    const handler = server.registered.get('rhythm_create_issue')!;
    const response = await handler({ title: 'Bad request' });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('422');
  });
});
