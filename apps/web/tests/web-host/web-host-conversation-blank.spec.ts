import { test, expect } from './parity-fixture';

test('#8: conversation: blank send and discarded draft leave the backend transcript unchanged', async ({ page, sessions, parity }) => {
  // Catches empty sends allocating turns and reload persisting an unsent draft as if the model had received it.
  await sessions.open();
  const row = await sessions.create(' empty composer');
  await page.getByTestId(`session-${row.id}`).click();
  const before = await sessions.api!.json<{ messages: unknown[] }>(`/agent-sessions/${row.id}`);
  await page.getByTestId('composer-input').fill('   ');
  await page.getByTestId('composer-send').click();
  await page.getByTestId('composer-input').fill(`${sessions.prefix} unsent`);
  await page.reload();
  await page.getByTestId(`session-${row.id}`).click();
  await expect(page.getByTestId('empty-state')).toContainText('Start this conversation');
  await expect(page.getByText(`${sessions.prefix} unsent`, { exact: true })).toHaveCount(0);
  const after = await sessions.api!.json<{ messages: unknown[] }>(`/agent-sessions/${row.id}`);
  expect(after.messages).toEqual(before.messages);
  const health = await parity.api.fetch('/health'); expect(await health.json()).toMatchObject({ status: 'ok' });
});
