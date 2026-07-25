#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');

test('issue-1096-c11: the notarized DMG passes a clean-user Engraph-absent FTS smoke without publishing', async () => {
  // Regression caught: a release workflow can report green after silently
  // skipping notarization, publishing an unwanted GitHub release, or never
  // launching the packaged app from a clean user state. Any missing release
  // guard below makes this contract fail before a candidate is dispatched.
  const workflow = await readFile(
    resolve(root, '.github/workflows/desktop_release.yml'),
    'utf8',
  );
  const smoke = await readFile(
    resolve(root, 'tools/release/smoke_signed_clean_user.sh'),
    'utf8',
  );

  assert.match(
    workflow,
    /publish_release:\s*\n(?:[^\n]*\n){0,6}\s+default:\s*false\b/,
    'release candidates must not publish by default',
  );
  assert.match(
    workflow,
    /name:\s*Require Apple signing and notarization credentials/,
    'the workflow must fail closed instead of silently shipping unsigned output',
  );
  assert.match(
    workflow,
    /name:\s*Verify signed and notarized artifacts/,
    'the workflow must verify signatures, Gatekeeper, and stapled tickets',
  );
  assert.match(
    workflow,
    /name:\s*Smoke signed app from clean user state/,
    'the workflow must execute the packaged app from clean user state',
  );
  assert.match(
    workflow,
    /tools\/release\/smoke_signed_clean_user\.sh/,
    'the clean-user behavioral smoke must be wired into the release job',
  );
  assert.match(
    workflow,
    /name:\s*Publish GitHub release\s*\n\s+if:\s*\$\{\{\s*inputs\.publish_release\s*\}\}/,
    'publishing must require an explicit workflow input',
  );

  for (const requiredBehavior of [
    /mktemp -d/,
    /hdiutil attach/,
    /codesign --verify/,
    /spctl --assess/,
    /xcrun stapler validate/,
    /HOME=/,
    /\/engraph-manager\/status/,
    /\/engraph-manager\/discover/,
    /\/agent-memory\b/,
    /\/agent-memory\/search/,
    /\.engraph/,
  ]) {
    assert.match(
      smoke,
      requiredBehavior,
      `clean-user smoke is missing ${requiredBehavior}`,
    );
  }
});
