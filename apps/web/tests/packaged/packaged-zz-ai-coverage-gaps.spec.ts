import { readFileSync } from 'node:fs';
import { test } from '@playwright/test';

type FeatureGap = { id: string; feature: string; kind: string; remaining: string; requires: string[]; source: string };
const inventory = JSON.parse(readFileSync(new URL('../../../../docs/ai/plans/2026-10-20-ai-feature-test-inventory.json', import.meta.url), 'utf8')) as { features: FeatureGap[] };

// These are coverage failures, never product-regression red proof. They intentionally
// use no app fixture and make no writes. Replace a gap with real behavior evidence;
// do not skip/delete it merely to make the qualification command green.
for (const feature of inventory.features.filter(row => row.kind === 'user-feature' && row.remaining)) {
  test(`[AI UNVERIFIED:${feature.id}] ${feature.feature}`, async ({}, info) => {
    info.annotations.push({ type: 'unverified', description: feature.source });
    throw new Error(`UNVERIFIED: ${feature.remaining} — requires ${feature.requires.join('; ')}`);
  });
}
