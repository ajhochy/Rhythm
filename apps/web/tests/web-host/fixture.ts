import { test as base, expect } from '@playwright/test';

export const apiBase = 'http://127.0.0.1:4098';
export async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${apiBase}${path}`, init);
  expect(response.ok, `${path}: HTTP ${response.status}`).toBeTruthy();
  return response.json();
}
export const test = base.extend<{ apiBase: string; api: typeof api }>({
  apiBase: async ({}, use) => use(apiBase),
  api: async ({}, use) => use(api),
});
export { expect };
