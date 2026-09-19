import { expect, test } from '@playwright/test';
import { agentSessionLinkFromHash } from '../../src/agentSessionLink';

test('session link preserves the exact local ID used by the Electron host', () => {
  expect(agentSessionLinkFromHash('#/agents?sessionId=local-session-A&approvalId=approval-A'))
    .toEqual({ sessionId: 'local-session-A' });
  expect(agentSessionLinkFromHash('#/agents?sessionId=local%2Dsession%2DA'))
    .toEqual({ sessionId: 'local-session-A' });
});

test('unrelated routes and bare Agents keep ordinary selection behavior', () => {
  for (const hash of ['#/agents', '#/agents?demo=running', '#/tasks?sessionId=local-A']) {
    expect(agentSessionLinkFromHash(hash)).toBeNull();
  }
});

test('ambiguous and malformed session links cannot silently select another session', () => {
  for (const query of ['sessionId=', 'sessionId=../x', 'sessionId=x&sessionId=y', 'sessionId=%00', `sessionId=${'a'.repeat(129)}`]) {
    expect(agentSessionLinkFromHash(`#/agents?${query}`)).toEqual({ error: 'The session link is invalid' });
  }
});
