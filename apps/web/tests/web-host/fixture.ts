import { test as base, expect } from '@playwright/test';
import http from 'node:http';

export const apiBase = 'http://rhythm-web.test:4098';
export async function api(path: string, init?: RequestInit) {
  return new Promise<any>((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:4098${path}`, {
      method: init?.method ?? 'GET',
      headers: { Host: new URL(apiBase).host, Origin: apiBase, 'Content-Type': 'application/json' },
    }, response => {
      let body = '';
      response.on('data', chunk => body += chunk);
      response.on('end', () => {
        try {
          expect(response.statusCode, `${path}: ${body}`).toBeGreaterThanOrEqual(200);
          expect(response.statusCode, `${path}: ${body}`).toBeLessThan(300);
          resolve(JSON.parse(body));
        } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end(init?.body);
  });
}
export const test = base.extend<{ apiBase: string; api: typeof api }>({
  apiBase: async ({}, use) => use(apiBase),
  api: async ({}, use) => use(api),
});
export { expect };
