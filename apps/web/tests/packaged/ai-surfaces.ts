import type { Page, Response } from '@playwright/test';
import { expect, ObservedApi } from './feature-test';

// Wire shapes and selectors observed in recon-ai-*.md. No seeded rows or fake main path.
export type AiSurface = {
  slug: string; endpoint: string; title: string; collection?: string;
  key: string; label: string; prefix: string; empty: string; error: string;
};
export const aiSurfaces: AiSurface[] = [
  { slug: 'brain', endpoint: '/agent-memory', title: 'Agent Memory', collection: 'items', key: 'id', label: 'title', prefix: 'memory-', empty: 'No memories found', error: 'brain-error' },
  { slug: 'skills', endpoint: '/opencode/skills', title: 'Skills', key: 'name', label: 'name', prefix: 'skills-item-', empty: 'No managed skills found', error: 'skills-error' },
  { slug: 'playbooks', endpoint: '/opencode/commands', title: 'Playbooks', key: 'name', label: 'name', prefix: 'playbook-', empty: 'No playbooks found', error: 'playbooks-error' },
  { slug: 'tasks', endpoint: '/agent-schedules', title: 'Agent Schedules', key: 'id', label: 'name', prefix: 'schedule-', empty: 'No schedules yet', error: 'schedules-error' },
  { slug: 'cookbook', endpoint: '/agent-cookbook', title: 'Cookbook', key: 'id', label: 'title', prefix: 'recipe-', empty: 'Your cookbook is empty', error: 'cookbook-error' },
  { slug: 'review', endpoint: '/agent-org-proposals', title: 'Review Queue', key: 'id', label: 'title', prefix: 'proposal-', empty: 'Nothing waiting for review', error: 'review-error' },
  { slug: 'report-card', endpoint: '/agents/run-quality', title: 'Agent Report Card', collection: 'agents', key: 'agentKind', label: 'agentLabel', prefix: 'report-agent-', empty: 'No scored runs yet', error: 'report-error' },
  { slug: 'gallery', endpoint: '/agent-designs', title: 'Creative Media', key: 'id', label: 'title', prefix: 'design-', empty: 'No creative artifacts yet', error: 'gallery-error' },
  { slug: 'deep-research', endpoint: '/agent-research/projects', title: 'Research Projects', key: 'id', label: 'name', prefix: 'research-project-', empty: 'No research projects yet', error: 'research-error' },
];
export type AiRow = Record<string, unknown>;

export async function openAiSurface(page: Page, surface: AiSurface): Promise<Response> {
  // Leave first so a repeated hash route cannot reuse its old collection silently.
  await page.goto('rhythm://app/index.html#/tools/agent-tools');
  await expect(page.getByTestId('agent-tools-catalog')).toBeVisible();
  const response = page.waitForResponse(r => new URL(r.url()).pathname === surface.endpoint && r.request().method() === 'GET', { timeout: 60_000 });
  void response.catch(() => {});
  await page.goto(`rhythm://app/index.html#/tools/${surface.slug}`);
  return response;
}

export async function readAiCollection(response: Response, surface: AiSurface): Promise<AiRow[]> {
  expect(response.request().method()).toBe('GET');
  expect(new URL(response.url()).pathname).toBe(surface.endpoint);
  expect(response.status(), `${surface.slug} collection failed`).toBe(200);
  const body = await response.json();
  const rows = surface.collection ? body[surface.collection] : body;
  expect(Array.isArray(rows), `${surface.slug} response schema drift`).toBe(true);
  return rows;
}

export async function assertAiRows(page: Page, surface: AiSurface, rows: AiRow[], response: Response) {
  const workspace = page.getByTestId(`tool-page-${surface.slug}`);
  await expect(workspace.locator('#tool-title')).toHaveText(surface.title);
  await expect(workspace.getByTestId(surface.error)).toHaveCount(0);
  if (!rows.length) {
    await expect(workspace.getByRole('heading', { name: surface.empty, exact: true })).toBeVisible();
    return;
  }
  const row = rows[0];
  expect(typeof row[surface.key]).toBe('string');
  const label = String(row[surface.label] || row[surface.key] || row.content || '');
  expect(label.length, 'an authoritative row must not render as blank').toBeGreaterThan(0);
  await expect(workspace.getByTestId(surface.prefix + row[surface.key])).toContainText(label);
  // Read back from the exact service/auth used by this UI, including its actual filters.
  const url = new URL(response.url());
  const body = await ObservedApi.from(response).json<AiRow[] | Record<string, AiRow[]>>(url.pathname + url.search);
  const canonical = surface.collection ? (body as Record<string, AiRow[]>)[surface.collection] : body as AiRow[];
  expect(canonical.some(item => item[surface.key] === row[surface.key]), 'rendered row vanished from authoritative collection').toBe(true);
}
