/**
 * #1424 provider-free live matrix: files, VCS, shell, and project init.
 *
 * This suite is deliberately env-gated. It drives the real api_server and
 * fork engine started by tools/dev/sandbox.sh and creates only disposable
 * repositories beneath that sandbox's own directory.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';

const RUN = process.env.RHYTHM_LIVE_E2E === '1';
const API = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:7470';
const ENGINE = process.env.RHYTHM_ENGINE_URL ?? 'http://127.0.0.1:7471';
const SANDBOX_DIR = process.env.RHYTHM_SANDBOX_DIR ?? '';

function expectIsolatedLiveTarget(): void {
  expect(SANDBOX_DIR).not.toBe('');
  expect(isAbsolute(SANDBOX_DIR)).toBe(true);
  expect(new URL(API).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  expect(new URL(ENGINE).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  expect([4000, 4001, 4002, 4096, 4097, 4098, 4099, 5173]).not.toContain(
    Number(new URL(API).port),
  );
  expect([4000, 4001, 4002, 4096, 4097, 4098, 4099, 5173]).not.toContain(
    Number(new URL(ENGINE).port),
  );
}

async function expectOk(response: Response, label: string): Promise<Response> {
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${await response.text()}`);
  }
  return response;
}

(RUN ? describe : describe.skip)('#1424 live — provider-free files/VCS/shell/init', () => {
  let root: string;
  let repo: string;
  let uninitializedProject: string;
  let sessionId: string | undefined;

  beforeAll(async () => {
    expectIsolatedLiveTarget();
    mkdirSync(SANDBOX_DIR, { recursive: true });
    root = mkdtempSync(join(SANDBOX_DIR, 'live-1424-files-vcs-'));
    repo = join(root, 'repo');
    uninitializedProject = join(root, 'uninitialized-project');
    mkdirSync(repo);
    mkdirSync(uninitializedProject);

    const git = (args: string[]) => execFileSync('git', args, { cwd: repo });
    git(['init', '-b', 'main']);
    git(['config', 'user.email', 'live-1424@example.invalid']);
    git(['config', 'user.name', 'Rhythm live #1424']);
    writeFileSync(join(repo, 'matrix-note.txt'), 'provider-free original marker\n', 'utf8');
    git(['add', 'matrix-note.txt']);
    git(['commit', '-m', 'synthetic baseline']);

    const createResponse = await expectOk(
      await fetch(`${API}/agent-sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentId: 'config-doctor',
          cwd: repo,
          name: '#1424 provider-free live matrix',
        }),
      }),
      'create session',
    );
    const created = (await createResponse.json()) as { id?: unknown; cwd?: unknown };
    expect(typeof created.id).toBe('string');
    expect(created.cwd).toBe(repo);
    sessionId = created.id as string;
  });

  afterAll(async () => {
    if (sessionId) {
      await fetch(`${API}/agent-sessions/${encodeURIComponent(sessionId)}/hard`, {
        method: 'DELETE',
      }).catch(() => undefined);
    }
    if (root && existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  it('1424:mega-1042-provider-free-live-tests:2 searches and reads the real committed file', async () => {
    // Regression caught: a proxy accidentally searches api_server cwd instead
    // of the session repository; the exact filename/content assertions fail.
    const foundResponse = await expectOk(
      await fetch(
        `${API}/agent-sessions/${sessionId}/files/find-files?query=${encodeURIComponent('matrix-note')}&limit=20&type=file`,
      ),
      'find files',
    );
    const found = (await foundResponse.json()) as unknown[];
    expect(found).toContain('matrix-note.txt');

    const readResponse = await expectOk(
      await fetch(
        `${API}/agent-sessions/${sessionId}/files/content?path=${encodeURIComponent('matrix-note.txt')}`,
      ),
      'read file',
    );
    const read = (await readResponse.json()) as { content?: unknown; resolvedPath?: unknown };
    expect(read.resolvedPath).toBe(join(repo, 'matrix-note.txt'));
    expect(read.content).toBe('provider-free original marker');
  });

  it('1424:mega-1042-provider-free-live-tests:3 reflects branch, dirty state, and both real diff forms', async () => {
    // Regression caught: cached VCS state stays clean after an on-disk edit;
    // dirty-count and both edit-marker assertions fail.
    const initialVcsResponse = await expectOk(
      await fetch(`${API}/agent-sessions/${sessionId}/vcs`),
      'initial VCS',
    );
    const initialVcs = (await initialVcsResponse.json()) as { branch?: unknown };
    expect(initialVcs.branch).toBe('main');

    const initialStatusResponse = await expectOk(
      await fetch(`${API}/agent-sessions/${sessionId}/vcs/status`),
      'initial VCS status',
    );
    expect((await initialStatusResponse.json()) as unknown[]).toHaveLength(0);

    writeFileSync(join(repo, 'matrix-note.txt'), 'provider-free edited marker\n', 'utf8');
    expect(readFileSync(join(repo, 'matrix-note.txt'), 'utf8')).toBe(
      'provider-free edited marker\n',
    );

    const dirtyResponse = await expectOk(
      await fetch(`${API}/agent-sessions/${sessionId}/vcs/status`),
      'dirty VCS status',
    );
    const dirty = (await dirtyResponse.json()) as unknown[];
    expect(dirty.length).toBeGreaterThan(0);
    expect(JSON.stringify(dirty)).toContain('matrix-note.txt');

    const structuredResponse = await expectOk(
      await fetch(`${API}/agent-sessions/${sessionId}/vcs/diff?mode=git`),
      'structured VCS diff',
    );
    const structured = (await structuredResponse.json()) as unknown[];
    expect(JSON.stringify(structured)).toContain('matrix-note.txt');
    expect(JSON.stringify(structured)).toContain('provider-free edited marker');

    const rawResponse = await expectOk(
      await fetch(`${API}/agent-sessions/${sessionId}/vcs/diff/raw`),
      'raw VCS diff',
    );
    const raw = await rawResponse.text();
    expect(raw).toContain('matrix-note.txt');
    expect(raw).toContain('+provider-free edited marker');
  });

  it('1424:mega-1042-provider-free-live-tests:4 runs pwd in the session repo', async () => {
    // Regression caught: session.shell drops the directory query and runs in
    // the engine process cwd; the completed tool output no longer equals repo.
    const shellResponse = await expectOk(
      await fetch(`${API}/agent-sessions/${sessionId}/shell`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'pwd' }),
      }),
      'session shell',
    );
    const shell = (await shellResponse.json()) as {
      parts?: Array<{ state?: { output?: unknown; metadata?: { output?: unknown } } }>;
    };
    const output = shell.parts?.map((part) =>
      typeof part.state?.output === 'string'
        ? part.state.output
        : typeof part.state?.metadata?.output === 'string'
          ? part.state.metadata.output
          : '',
    ).join('') ?? '';
    expect(output.trim()).toBe(repo);
  });

  it('1424:mega-1042-provider-free-live-tests:5 initializes a real project artifact on disk', async () => {
    // Regression caught: project.initGit reports success without creating the
    // repository; both the returned VCS marker and .git assertion fail.
    expect(existsSync(join(uninitializedProject, '.git'))).toBe(false);
    const response = await expectOk(
      await fetch(
        `${ENGINE}/project/git/init?directory=${encodeURIComponent(uninitializedProject)}`,
        { method: 'POST' },
      ),
      'project git init',
    );
    const project = (await response.json()) as { vcs?: unknown; worktree?: unknown };
    expect(project.vcs).toBe('git');
    expect(project.worktree).toBe(uninitializedProject);
    expect(existsSync(join(uninitializedProject, '.git'))).toBe(true);
  });
});
