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

// Bounded so a hanging feed becomes a reported drift for that route instead
// of a silently killed test process (an engine cold start can exceed 90s).
const FETCH_TIMEOUT_MS = Number(
  process.env.RHYTHM_LIVE_PARITY_FETCH_TIMEOUT_MS ?? 45_000,
);

async function readJson(baseUrl, path, kind) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    headers: safeHeaders(kind),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
const VOLATILE_KEY =
  /^(createdAt|updatedAt|lastRunAt|receivedAt|generatedAt)$/i;

// The gateway deliberately redacts secrets and host paths before payloads
// reach a phone (apps/api_server/src/services/mobile_opencode_security.ts).
// Parity is asserted modulo that documented contract: desktop values are aligned
// to the mobile side's placeholders/omissions before comparing, so only
// genuine data drift fails the gate. New redactions surface as drift first —
// extend these sets consciously when the gateway's policy grows.
const REDACTION_PLACEHOLDERS = new Set(['[redacted]', '[redacted-path]']);
const GATEWAY_OMITTED_FIELDS = new Set([
  'env', 'environment', 'header', 'headers',
  'cwd', 'home', 'root', 'roots', 'workingdirectory', 'worktree',
  'worktreedir', 'directory', 'workspace', 'workspaceid',
]);
const MCP_DESKTOP_ENRICHMENT_FIELDS = new Set([
  'environment',
  'requiredEnv',
  'needsCredentials',
  'source',
  'tools',
]);

export function alignGatewayRedactions(mobile, desktop) {
  if (Array.isArray(mobile) && Array.isArray(desktop)) {
    return desktop.map((item, index) =>
      alignGatewayRedactions(mobile[index], item));
  }
  const bothObjects = mobile && desktop &&
    typeof mobile === 'object' && typeof desktop === 'object' &&
    !Array.isArray(mobile) && !Array.isArray(desktop);
  if (bothObjects) {
    return Object.fromEntries(
      Object.entries(desktop)
        .filter(([key]) =>
          key in mobile || !GATEWAY_OMITTED_FIELDS.has(key.toLowerCase()))
        .map(([key, value]) =>
          [key, alignGatewayRedactions(mobile[key], value)]),
    );
  }
  if (typeof mobile === 'string' && REDACTION_PLACEHOLDERS.has(mobile)) {
    return mobile;
  }
  return desktop;
}

function mcpStatusProjection(value) {
  if (!Array.isArray(value)) return value;
  return Object.fromEntries(
    value
      .filter((entry) =>
        entry && typeof entry === 'object' && typeof entry.name === 'string')
      .map((entry) => [
        entry.name,
        Object.fromEntries(
          Object.entries(entry).filter(([key]) =>
            key !== 'name' && !MCP_DESKTOP_ENRICHMENT_FIELDS.has(key)),
        ),
      ])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function stableArraySortKey(item, route) {
  if (!item || typeof item !== 'object') return JSON.stringify(item);
  if (typeof item.id === 'string') return `id:${item.id}`;
  if (route === '/provider/auth') {
    // The mobile security boundary redacts every plain `key` field, including
    // provider prompt identifiers. Pair arrays by stable, non-secret display
    // identity so redaction cannot change their relative ordering.
    return ['message', 'label', 'name', 'type', 'value']
      .map((field) =>
        typeof item[field] === 'string' ? `${field}:${item[field]}` : '')
      .join('|');
  }
  return JSON.stringify(item);
}

export function parityValue(value, route, nested = false) {
  const comparable =
    route === '/opencode/mcp' && !nested
      ? mcpStatusProjection(value)
      : value;
  if (Array.isArray(comparable)) {
    // Sort by id when present: redaction changes JSON-string ordering between
    // the two sides, and pairwise alignment needs identical item order.
    return comparable
      .map((child) => parityValue(child, route, true))
      .sort((left, right) =>
        stableArraySortKey(left, route)
          .localeCompare(stableArraySortKey(right, route)));
  }
  if (!comparable || typeof comparable !== 'object') return comparable;
  return Object.fromEntries(
    Object.entries(comparable)
      .filter(([key]) => !SENSITIVE_KEY.test(key) && !VOLATILE_KEY.test(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, parityValue(child, route, true)]),
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
    // The desktop client reads provider/config truth straight from the
    // opencode engine (the gateway proxies /opencode/* there verbatim and
    // stamps directory=<project root>), so those routes compare against the
    // engine with the same directory scope — not the desktop API.
    const ENGINE_ROUTES = new Set(['/provider', '/provider/auth', '/config']);
    // Soft-assert every route so one drift doesn't hide the rest; the gate's
    // evidence needs the full list of divergent feeds, not just the first.
    const drifts = [];
    for (const [mobilePath, desktopPath] of parityRoutes) {
      try {
        const isEngine = ENGINE_ROUTES.has(desktopPath.split('?')[0]);
        const desktopBase = isEngine
          ? required('RHYTHM_LIVE_DESKTOP_ENGINE_URL')
          : desktopUrl;
        const resolvedDesktopPath = isEngine
          ? `${desktopPath}${desktopPath.includes('?') ? '&' : '?'}directory=${
            encodeURIComponent(required('RHYTHM_LIVE_PROJECT_ROOT'))}`
          : desktopPath;
        const [mobile, desktop] = await Promise.all([
          readJson(mobileUrl, mobilePath, 'mobile'),
          readJson(desktopBase, resolvedDesktopPath, 'desktop'),
        ]);
        const mobileNorm = parityValue(mobile, desktopPath);
        const desktopNorm = alignGatewayRedactions(
          mobileNorm,
          parityValue(desktop, desktopPath),
        );
        const mobileJson = JSON.stringify(mobileNorm);
        const desktopJson = JSON.stringify(desktopNorm);
        if (mobileJson !== desktopJson) {
          // assert.deepEqual's diff rendering on multi-MB payloads (engine
          // /provider, /config) exhausts memory and gets the process
          // SIGKILLed — only use it when both payloads are small.
          if (mobileJson.length + desktopJson.length < 262_144) {
            assert.deepEqual(
              mobileNorm,
              desktopNorm,
              `mobile/desktop parity drift for ${desktopPath}`,
            );
          }
          let at = 0;
          while (mobileJson[at] === desktopJson[at]) at += 1;
          assert.fail(
            `mobile/desktop parity drift for ${desktopPath}: normalized ` +
            `payloads differ (mobile ${mobileJson.length}B vs desktop ` +
            `${desktopJson.length}B); first divergence at char ${at}:\n` +
            `mobile:  …${mobileJson.slice(Math.max(0, at - 80), at + 160)}…\n` +
            `desktop: …${desktopJson.slice(Math.max(0, at - 80), at + 160)}…`,
          );
        }
        console.error(`parity ok: ${desktopPath}`);
      } catch (error) {
        console.error(`parity DRIFT: ${desktopPath}`);
        drifts.push({ route: desktopPath, error });
      }
    }
    if (drifts.length > 0) {
      const routes = drifts.map((d) => d.route).join(', ');
      const details = drifts
        .map((d) => String(d.error?.message ?? d.error))
        .join('\n\n');
      assert.fail(
        `${drifts.length}/${parityRoutes.length} routes drifted: ${routes}\n\n${details}`,
      );
    }
  },
);
