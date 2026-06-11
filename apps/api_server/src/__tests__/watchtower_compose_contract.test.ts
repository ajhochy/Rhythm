/**
 * Acceptance-contract tests for the Watchtower opt-in label
 * (chore/watchtower-label-rhythm-api — user-approved proposal, no issue #).
 *
 * The statements project runs a host-wide Watchtower in label-enable mode
 * (WATCHTOWER_LABEL_ENABLE=true). Opting rhythm-api in means new :main
 * images from GHCR are auto-pulled and the container recreated.
 *
 * c1: the rhythm-api service in docker-compose.synology.yml carries
 *     com.centurylinklabs.watchtower.enable: "true". MUST FAIL pre-change.
 * c2: the cloudflared service does NOT carry the enable label (the tunnel
 *     stays pinned; regression guard).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const COMPOSE_PATH = path.join(__dirname, '..', '..', 'docker-compose.synology.yml');
const ENABLE_LABEL = /com\.centurylinklabs\.watchtower\.enable['"]?\s*:\s*['"]true['"]/;

/** Extract one top-level service block (2-space indent) from the compose file. */
function serviceBlock(compose: string, name: string): string {
  const lines = compose.split('\n');
  const start = lines.findIndex((l) => l.trimEnd() === `  ${name}:`);
  expect(start, `service '${name}' present in compose file`).toBeGreaterThan(-1);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= 2 && !line.trimStart().startsWith('#')) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

describe('docker-compose.synology.yml — Watchtower opt-in contract', () => {
  const compose = readFileSync(COMPOSE_PATH, 'utf8');

  it('watchtower-rhythm-api-c1: rhythm-api opts into Watchtower label-enable updates', () => {
    const block = serviceBlock(compose, 'rhythm-api');
    expect(block, 'rhythm-api must carry the Watchtower enable label').toMatch(ENABLE_LABEL);
  });

  it('watchtower-rhythm-api-c2: cloudflared stays out of Watchtower auto-updates', () => {
    const block = serviceBlock(compose, 'cloudflared');
    expect(block, 'cloudflared must NOT carry the Watchtower enable label').not.toMatch(
      ENABLE_LABEL,
    );
  });
});
