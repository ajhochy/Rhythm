import { defineConfig } from '@playwright/test';
import base from './c1-live-reconnect-playwright.config';

export default defineConfig({
  ...base,
  testMatch: ['installed-ws-profile-identity.spec.ts'],
  timeout: 90_000,
});
