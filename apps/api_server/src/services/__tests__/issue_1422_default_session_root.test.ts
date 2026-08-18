import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Project } from '../../models/project';

// The default root is read off `env` at call time, so the suite swaps it per
// case rather than depending on whatever the host machine's ~/Documents is.
let mockDefaultRoot = '';
vi.mock('../../config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/env')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      get defaultSessionRoot() {
        return mockDefaultRoot;
      },
    },
  };
});

const { requireMobileProjectScope, resolveMobileProjectPath } = await import(
  '../mobile_project_scope'
);

type FakeRequestInit = {
  projectHeader?: string;
  body?: unknown;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
};

function fakeRequest(init: FakeRequestInit = {}): Request {
  const headers: Record<string, string> = { ...init.headers };
  if (init.projectHeader !== undefined) {
    headers['x-rhythm-project-id'] = init.projectHeader;
  }
  return {
    body: init.body ?? {},
    method: 'GET',
    path: '/mobile-gateway/chat-catalog',
    query: init.query ?? {},
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

/** Runs the middleware and returns either the attached scope or the error. */
function runScope(req: Request, projects: { findById: (id: string) => Project | null }) {
  let failure: unknown;
  const next: NextFunction = (error?: unknown) => {
    failure = error;
  };
  requireMobileProjectScope(projects)(req, {} as Response, next);
  return { failure, scope: req.mobileProject };
}

describe('issue-1422: default session root for project-less mobile sessions', () => {
  let boundary: string;
  let defaultRoot: string;
  let projectRoot: string;
  let outside: string;
  const noProjects = { findById: () => null };

  beforeEach(() => {
    // realpath: on macOS the temp dir is itself a /var -> /private/var symlink,
    // and every root the resolver returns is canonicalized.
    boundary = realpathSync(mkdtempSync(join(tmpdir(), 'issue-1422-')));
    defaultRoot = join(boundary, 'Documents');
    projectRoot = join(boundary, 'registered');
    outside = join(boundary, 'outside');
    mkdirSync(join(defaultRoot, 'nested'), { recursive: true });
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(defaultRoot, 'nested', 'inside.txt'), 'inside');
    writeFileSync(join(outside, 'secret.txt'), 'outside');
    // A symlink that escapes the default root — canonicalization must catch it.
    symlinkSync(outside, join(defaultRoot, 'escape'));
    mockDefaultRoot = defaultRoot;
  });

  afterEach(() => {
    rmSync(boundary, { recursive: true, force: true });
  });

  it('issue-1422-c1: a request with no project header resolves to the default root instead of 400ing', () => {
    // Regression caught: requireMobileProjectScope threw
    // 'X-Rhythm-Project-ID is required', so a legitimately project-less session
    // (a shape desktop fully supports) could not make any mobile request.
    const { failure, scope } = runScope(fakeRequest(), noProjects);

    expect(failure, 'a project-less request must not fail').toBeUndefined();
    expect(scope?.root).toBe(defaultRoot);
    // Empty id == "no project", matching how desktop persists an unassigned
    // session — never a sentinel that could collide with a real project id.
    expect(scope?.id).toBe('');
  });

  it('issue-1422-c2: an explicit project id still resolves to that project real root', () => {
    const project: Project = {
      id: 'registered-project',
      name: 'Registered',
      cwd: projectRoot,
      icon: null,
      archivedAt: null,
    } as unknown as Project;

    const { failure, scope } = runScope(
      fakeRequest({ projectHeader: 'registered-project' }),
      { findById: (id) => (id === 'registered-project' ? project : null) },
    );

    expect(failure).toBeUndefined();
    expect(scope?.root).toBe(projectRoot);
    expect(scope?.id).toBe('registered-project');
    expect(scope?.root, 'an explicit project must not inherit the default root')
      .not.toBe(defaultRoot);
  });

  it('issue-1422-c3: containment still rejects traversal outside the default root', () => {
    const { scope } = runScope(fakeRequest(), noProjects);
    expect(scope).toBeDefined();

    // Relative traversal, absolute escape, and a symlink that resolves outside
    // must all be refused — the default root is a real boundary, not a bypass.
    expect(() => resolveMobileProjectPath(scope!, '../outside/secret.txt')).toThrow();
    expect(() => resolveMobileProjectPath(scope!, join(outside, 'secret.txt'))).toThrow();
    expect(() => resolveMobileProjectPath(scope!, 'escape/secret.txt')).toThrow();

    // A genuinely contained path still resolves.
    expect(resolveMobileProjectPath(scope!, 'nested/inside.txt')).toBe(
      join(defaultRoot, 'nested', 'inside.txt'),
    );
  });

  it('issue-1422-c4: caller-supplied root overrides are still rejected with no project header', () => {
    // The default root must not become a way to smuggle in a caller root.
    for (const field of ['root', 'cwd', 'directory', 'worktreeDir', 'workspace']) {
      const { failure } = runScope(
        fakeRequest({ body: { [field]: outside } }),
        noProjects,
      );
      expect(failure, `${field} in the body must be rejected`).toBeDefined();
    }

    const viaQuery = runScope(fakeRequest({ query: { cwd: outside } }), noProjects);
    expect(viaQuery.failure, 'cwd in the query must be rejected').toBeDefined();

    const viaHeader = runScope(
      fakeRequest({ headers: { 'x-rhythm-project-root': outside } }),
      noProjects,
    );
    expect(viaHeader.failure, 'X-Rhythm-Project-Root must be rejected').toBeDefined();
  });

  it('issue-1422-c5: a missing or non-directory default root fails closed', () => {
    // Never silently widen to the process cwd or / when the configured root is
    // unusable — that would be worse than the original 400.
    mockDefaultRoot = join(boundary, 'does-not-exist');
    expect(runScope(fakeRequest(), noProjects).failure).toBeDefined();

    const filePath = join(boundary, 'a-file.txt');
    writeFileSync(filePath, 'not a directory');
    mockDefaultRoot = filePath;
    expect(runScope(fakeRequest(), noProjects).failure).toBeDefined();

    mockDefaultRoot = '';
    expect(runScope(fakeRequest(), noProjects).failure).toBeDefined();
  });
});
