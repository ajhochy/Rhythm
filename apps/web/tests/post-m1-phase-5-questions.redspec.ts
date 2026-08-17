import { expect, test } from '@playwright/test';
import { localSessionId, openInterceptedLiveApp } from './post-m1-phase-5-live-fixtures';

test('post-m1-p5-c1d: full multi-question shape replies once with answers:string[][] and honors remote resolution', async ({ page }) => {
  // Regression caught: React collapses the canonical question array into one options:string[] fixture;
  // the heading/description assertions fail, or the submitted matrix has the wrong shape.
  const boundary = await openInterceptedLiveApp(page, '/#/agents', {
    handleApi: async (route, request) => {
      if (request.pathname === `/agent-sessions/${localSessionId}/question/call-phase-5/reply`) {
        await route.fulfill({ status: 204 });
        return true;
      }
      return false;
    },
  });
  const asked = {
    v: 1,
    type: 'question.asked',
    sessionId: localSessionId,
    requestId: 'que-phase-5',
    callId: 'call-phase-5',
    questions: [
      { header: 'Services', question: 'Which services?', options: [{ label: 'Morning', description: '9:00 service' }, { label: 'Evening', description: '18:00 service' }], multiple: true, custom: false },
      { header: 'Owner', question: 'Who owns the handoff?', options: [{ label: 'Morgan', description: 'Production lead' }], multiple: false, custom: true },
    ],
  };
  boundary.send(asked);

  const card = page.getByTestId('question-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Services');
  await expect(card).toContainText('9:00 service');
  await expect(card).toContainText('Owner');
  await expect(card).toContainText('Production lead');

  boundary.send({ v: 1, type: 'question.resolved', sessionId: localSessionId, requestId: 'que-phase-5', rejected: false });
  await expect(card).toHaveCount(0);
  boundary.send(asked);
  await page.getByLabel('Morning').check();
  await page.getByLabel('Evening').check();
  await page.getByLabel('Custom answer').fill('Alex');
  await page.getByTestId('question-answer').click();

  await expect.poll(() => boundary.requests.filter((request) => request.pathname.endsWith('/question/call-phase-5/reply')).length).toBe(1);
  expect(boundary.requests.find((request) => request.pathname.endsWith('/question/call-phase-5/reply'))?.body).toEqual({ answers: [['Morning', 'Evening'], ['Alex']] });
});
