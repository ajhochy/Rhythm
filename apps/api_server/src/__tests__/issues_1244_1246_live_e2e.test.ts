import { describe, expect, it } from 'vitest';

const live = process.env.RHYTHM_LIVE_E2E === '1' ? describe : describe.skip;

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

live('issues #1244-#1246 live task and milestone behavior', () => {
  it('observes organization, energy, and milestone grouping through the real API', async () => {
    const baseUrl = process.env.RHYTHM_LIVE_API_URL ?? 'http://127.0.0.1:4098';
    const token = process.env.RHYTHM_LIVE_AUTH_TOKEN;
    expect(token, 'RHYTHM_LIVE_AUTH_TOKEN is required').toBeTruthy();
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const taskResponse = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: `Live organized task ${Date.now()}`,
        priority: 4,
        tags: ['worship', 'weekend'],
        energy: '🔥',
      }),
    });
    expect(taskResponse.status).toBe(201);
    const task = await readJson(taskResponse);
    expect(task).toMatchObject({ priority: 4, tags: ['worship', 'weekend'], energy: '🔥' });
    const filtered = await readJson(
      await fetch(`${baseUrl}/tasks?tag=worship&min_priority=4`, { headers }),
    );
    expect(filtered).toEqual(expect.arrayContaining([expect.objectContaining({ id: task.id })]));

    const templateResponse = await fetch(`${baseUrl}/project-templates`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: `Live milestone template ${Date.now()}`, name: `Live milestone template ${Date.now()}` }),
    });
    expect(templateResponse.status).toBe(201);
    const template = await readJson(templateResponse);
    const stepResponse = await fetch(`${baseUrl}/project-templates/${template.id}/steps`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'First phase task', offsetDays: 0, sortOrder: 0 }),
    });
    expect(stepResponse.status).toBe(201);

    const instanceResponse = await fetch(`${baseUrl}/project-instances`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        templateId: template.id,
        anchorDate: '2026-12-01',
        name: `Live milestone project ${Date.now()}`,
      }),
    });
    expect(instanceResponse.status).toBe(201);
    const instance = await readJson(instanceResponse);
    expect(instance.steps).toHaveLength(1);

    const milestoneResponse = await fetch(
      `${baseUrl}/project-instances/${instance.id}/milestones`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: 'Planning', sortOrder: 0 }),
      },
    );
    expect(milestoneResponse.status).toBe(201);
    const milestone = await readJson(milestoneResponse);
    const assignedResponse = await fetch(
      `${baseUrl}/project-instances/steps/${instance.steps[0].id}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ milestoneId: milestone.id }),
      },
    );
    expect(assignedResponse.status).toBe(200);
    expect(await readJson(assignedResponse)).toMatchObject({ milestoneId: milestone.id });

    const instances = await readJson(
      await fetch(`${baseUrl}/project-instances`, { headers }),
    );
    expect(instances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: instance.id,
          milestones: expect.arrayContaining([expect.objectContaining({ id: milestone.id })]),
          steps: expect.arrayContaining([expect.objectContaining({ milestoneId: milestone.id })]),
        }),
      ]),
    );

    await fetch(`${baseUrl}/project-instances/${instance.id}/milestones/${milestone.id}`, {
      method: 'DELETE',
      headers,
    });
    await fetch(`${baseUrl}/project-instances/${instance.id}`, { method: 'DELETE', headers });
    await fetch(`${baseUrl}/project-templates/${template.id}`, { method: 'DELETE', headers });
    await fetch(`${baseUrl}/tasks/${task.id}`, { method: 'DELETE', headers });
  });
});
