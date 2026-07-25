import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Project } from '../../models/project';
import {
  resolveMobileProject,
  resolveMobileProjectPath,
} from '../mobile_project_scope';

describe('mobile project scope', () => {
  let boundary: string;
  let root: string;
  let outside: string;

  beforeEach(() => {
    boundary = mkdtempSync(join(tmpdir(), 'mobile-project-scope-'));
    root = join(boundary, 'registered');
    outside = join(boundary, 'outside');
    mkdirSync(join(root, 'nested'), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(root, 'nested', 'inside.txt'), 'inside');
    writeFileSync(join(outside, 'secret.txt'), 'outside');
    symlinkSync(outside, join(root, 'escape'));
  });

  afterEach(() => {
    rmSync(boundary, { recursive: true, force: true });
  });

  it('issue-1168-c2: repository-owned roots are canonical and every mobile path remains contained', () => {
    const project: Project = {
      id: 'registered-project',
      name: 'Registered',
      cwd: root,
      icon: null,
      vcsRoot: outside,
      vcsBranch: null,
      vcsDirty: false,
      vcsCheckedAt: null,
      createdAt: new Date().toISOString(),
      archivedAt: null,
    };
    const repository = {
      findById: (id: string) => id === project.id ? project : null,
    };

    const scope = resolveMobileProject(project.id, repository);
    expect(scope).toEqual({
      id: project.id,
      root: realpathSync(root),
    });
    expect(scope.root).not.toBe(project.vcsRoot);
    expect(resolveMobileProjectPath(scope, 'nested/inside.txt'))
      .toBe(realpathSync(join(root, 'nested', 'inside.txt')));
    expect(resolveMobileProjectPath(scope, 'nested/new-file.txt'))
      .toBe(join(realpathSync(root), 'nested', 'new-file.txt'));

    const sibling = join(boundary, `${basename(root)}-sibling`);
    mkdirSync(sibling);
    writeFileSync(join(sibling, 'secret.txt'), 'sibling');
    const rejected = [
      join('..', basename(outside), 'secret.txt'),
      join(sibling, 'secret.txt'),
      'escape/secret.txt',
      '\0not-a-path',
    ];
    for (const candidate of rejected) {
      expect(() => resolveMobileProjectPath(scope, candidate), candidate)
        .toThrowError(expect.objectContaining({
          statusCode: 403,
          code: 'FORBIDDEN',
        }));
    }

    expect(() => resolveMobileProject('unknown-project', repository))
      .toThrowError(expect.objectContaining({ statusCode: 404 }));
    expect(() =>
      resolveMobileProject(project.id, {
        findById: () => ({ ...project, archivedAt: new Date().toISOString() }),
      }))
      .toThrowError(expect.objectContaining({ statusCode: 404 }));
  });
});
