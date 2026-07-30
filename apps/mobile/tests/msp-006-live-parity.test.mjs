import assert from 'node:assert/strict';
import { test } from 'node:test';

const live = process.env.RHYTHM_LIVE_E2E === '1';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the MSP-006 live parity test.`);
  return value;
}

function safeHeaders(kind) {
  if (kind === 'mobile') {
    return {
      Authorization: `Device ${required('RHYTHM_LIVE_MOBILE_DEVICE_TOKEN')}`,
      'X-Rhythm-Project-ID': required('RHYTHM_LIVE_PROJECT_ID'),
    };
  }
  const authorization = process.env.RHYTHM_LIVE_DESKTOP_AUTHORIZATION?.trim();
  return authorization ? { Authorization: authorization } : {};
}

async function readJson(baseUrl, path, kind) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    headers: safeHeaders(kind),
  });
  assert.equal(
    response.ok,
    true,
    `${kind} parity request failed for ${path} (${response.status})`,
  );
  return response.json();
}

const SENSITIVE_KEY =
  /(authorization|cookie|credential|password|secret|token|oauth|api[_-]?key)/i;
const VOLATILE_KEY = /^(createdAt|updatedAt|lastRunAt|receivedAt)$/i;

function parityValue(value) {
  if (Array.isArray(value)) {
    return value
      .map(parityValue)
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEY.test(key) && !VOLATILE_KEY.test(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, parityValue(child)]),
  );
}

const parityRoutes = [
  ['/mobile-gateway/tools/agent-memory', '/agent-memory'],
  ['/mobile-gateway/tools/agent-research', '/agent-research'],
  ['/mobile-gateway/tools/agent-schedules', '/agent-schedules'],
  ['/mobile-gateway/tools/agent-webhooks', '/agent-webhooks'],
  ['/mobile-gateway/tools/agent-configs', '/agent-configs'],
  ['/mobile-gateway/tools/agent-cookbook', '/agent-cookbook'],
  ['/mobile-gateway/tools/agent-org-proposals?status=pending', '/agent-org-proposals?status=pending'],
  ['/mobile-gateway/tools/agents/run-quality?windowDays=30', '/agents/run-quality?windowDays=30'],
  ['/mobile-gateway/tools/opencode/skills?withMetadata=true', '/opencode/skills?withMetadata=true'],
  ['/mobile-gateway/tools/opencode/commands', '/opencode/commands'],
  ['/mobile-gateway/opencode/mcp', '/opencode/mcp'],
  ['/mobile-gateway/opencode/provider', '/provider'],
  ['/mobile-gateway/opencode/provider/auth', '/provider/auth'],
  ['/mobile-gateway/opencode/config', '/config'],
];

test(
  'MSP-006 live parity: mobile gateway matches desktop-path Tools data',
  { skip: !live },
  async () => {
    const mobileUrl = required('RHYTHM_LIVE_MOBILE_GATEWAY_URL');
    const desktopUrl = required('RHYTHM_LIVE_DESKTOP_API_URL');
    for (const [mobilePath, desktopPath] of parityRoutes) {
      const [mobile, desktop] = await Promise.all([
        readJson(mobileUrl, mobilePath, 'mobile'),
        readJson(desktopUrl, desktopPath, 'desktop'),
      ]);
      assert.deepEqual(
        parityValue(mobile),
        parityValue(desktop),
        `mobile/desktop parity drift for ${desktopPath}`,
      );
    }
  },
);
