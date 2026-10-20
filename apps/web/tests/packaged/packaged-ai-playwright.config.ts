import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import packaged from './packaged-playwright.config';

// Includes explicit failing coverage gaps. Never report only the runnable subset as full AI qualification.
export default defineConfig({
  ...packaged,
  testMatch: [
    'packaged-ai-*.spec.ts',
    'packaged-zz-ai-coverage-gaps.spec.ts',
    'packaged-sessions.spec.ts',
    'packaged-session-project-scope.spec.ts',
    'packaged-conversation.spec.ts',
    'packaged-rhythm-primary-chat.spec.ts',
    'packaged-coordinator-multi-run.spec.ts',
    'packaged-approval-expiry.spec.ts',
    'packaged-model-router.spec.ts',
  ],
  reporter: [['list'], ['json', { outputFile: fileURLToPath(new URL('../../test-results/ai-behavior.json', import.meta.url)) }], ['html', { open: 'never', outputFolder: fileURLToPath(new URL('../../playwright-report/ai-behavior', import.meta.url)) }]],
});
