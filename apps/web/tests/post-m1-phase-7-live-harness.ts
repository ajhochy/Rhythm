import { expect, type Page, type Request, type Route } from '@playwright/test';

export type SeenRequest = {
  method: string;
  pathname: string;
  search: string;
  body: unknown;
};

export type ApiHandler = (route: Route, request: Request) => Promise<boolean> | boolean;

const corsHeaders = {
  'access-control-allow-origin': 'http://127.0.0.1:4173',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-rhythm-human-approval-capability',
};

export const fulfillJson = (route: Route, status: number, json: unknown) =>
  route.fulfill({ status, headers: corsHeaders, json });

export async function openPhase7Live(
  page: Page,
  hashRoute: string,
  seen: SeenRequest[],
  handler?: ApiHandler,
): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.route('http://127.0.0.1:4097/**', (route) =>
    fulfillJson(route, 200, { healthy: true }));
  await page.route('http://127.0.0.1:4098/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    const url = new URL(request.url());
    let body: unknown;
    try {
      body = request.postDataJSON();
    } catch {
      body = request.postData() ?? undefined;
    }
    seen.push({ method: request.method(), pathname: url.pathname, search: url.search, body });
    if (handler && await handler(route, request)) return;
    if (url.pathname === '/health') {
      await fulfillJson(route, 200, { status: 'ok', healthy: true });
      return;
    }
    if (url.pathname === '/agent-configs') {
      await fulfillJson(route, 200, []);
      return;
    }
    if (url.pathname === '/agent-sessions') {
      await fulfillJson(route, 200, { sessions: [] });
      return;
    }
    await fulfillJson(route, 404, { error: { code: 'NOT_FOUND' } });
  });
  await page.goto(`/#${hashRoute}`);
  await expect(page.locator('main#main-content')).toBeVisible();
}

export function matching(
  seen: SeenRequest[],
  method: string,
  pathname: string,
): SeenRequest[] {
  return seen.filter((request) => request.method === method && request.pathname === pathname);
}
