import { defineConfig } from '@playwright/test';
import base from './post-m1-phase-9-session-continuity-live-playwright.config';

export default defineConfig({ ...base, testMatch: 'issue-1603-diff-omission.spec.ts' });
