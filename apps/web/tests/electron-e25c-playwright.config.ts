import { defineConfig } from '@playwright/test';
import previous from './electron-e25b-playwright.config';
export default defineConfig({ ...previous, testMatch: 'electron-e25c-sharing.spec.ts', outputDir: '/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/e25c-results' });
