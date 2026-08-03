import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyToolFailure,
  normalizeToolScreenResponse,
} from '../../providers/services/rhythm-tools-service.ts';

test('issue-1281-c2: the mobile Memories adapter preserves the server list response', () => {
  // Regression caught: a valid 200 response containing memory rows is
  // normalized to [], causing the screen to render the actual-empty state.
  const serverResponse = [{
    id: 'memory-1281',
    kind: 'fact',
    content: 'Issue 1281 global memory visible on mobile',
    source: 'vault',
    sourceId: 'fact/issue-1281.md',
    tagsJson: '[]',
    ownerUserId: null,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  }];

  assert.deepEqual(
    normalizeToolScreenResponse('brain', serverResponse),
    serverResponse,
  );
  assert.equal(classifyToolFailure(undefined, 'connected'), null);
  assert.deepEqual(normalizeToolScreenResponse('brain', []), []);
});
