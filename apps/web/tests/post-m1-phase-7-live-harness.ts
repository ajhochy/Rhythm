import { expect, type Page, type Request, type Route } from '@playwright/test';

export type SeenRequest = {
  method: string;
  pathname: string;
  search: string;
  body: unknown;
};

export type ApiHandler = (route: Route, request: Request) => Promise<boolean> | boolean;

// ponytail: reflect the requesting page's own origin instead of a hardcoded port. This worktree's
// dev server runs on a port-remapped baseURL (see tests/post-m1-phase-7-fixture-playwright.config.ts
// webServer, 4173+800=4973) to avoid cross-worktree contamination between sibling agents sharing this
// machine; a fixed 'http://127.0.0.1:4173' Access-Control-Allow-Origin silently mismatches that and
// the browser blocks every mocked response as a CORS violation (fetch rejects with a generic network
// error, surfaced upstream as e.g. "Schedule service unavailable" with no indication it was CORS).
const corsHeadersFor = (request: Request) => ({
  'access-control-allow-origin': request.headers()['origin'] ?? '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-rhythm-human-approval-capability',
});

export const fulfillJson = (route: Route, status: number, json: unknown) =>
  route.fulfill({ status, headers: corsHeadersFor(route.request()), json });

export async function openPhase7Live(
  page: Page,
  hashRoute: string,
  seen: SeenRequest[],
  handler?: ApiHandler,
): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.route('http://127.0.0.1:4097/**', (route) =>
    fulfillJson(route, 200, { healthy: true }));
  await page.route(/^http:\/\/127\.0\.0\.1:(?:4098|4198)\//, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeadersFor(request) });
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
