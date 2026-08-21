const BRIDGE_KEYS = ['version', 'appVersion', 'platform', 'gateway', 'auth', 'humanApproval', 'agentServer'];
const GATEWAY_KEYS = ['apiBase', 'engineBase', 'productionApiBase', 'setProductionApiBase'];
const AUTH_KEYS = ['signInWithGoogle'];
const HUMAN_APPROVAL_KEYS = ['capability', 'signDecision'];
const AGENT_SERVER_KEYS = ['status', 'onStatusChange'];
const DENIAL_KEYS = ['navigation', 'popup', 'permission', 'download', 'malformedProtocol'];

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} root @param {string[]} path */
function valueAt(root, path) {
  let current = root;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** @param {unknown} value @param {string[]} expected */
function isExactStringArray(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && expected.every((entry, index) => value[index] === entry);
}

/**
 * Validates the security receipt produced from the actual rendered preload and Electron policies.
 * This is intentionally independent of the source unit tests: the signed release workflow invokes
 * the packaged executable and must receive a nonzero exit if composition changed any invariant.
 * @param {unknown} receipt
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateSecuritySmokeReceipt(receipt) {
  const exactArrays = [
    [['bridge', 'keys'], BRIDGE_KEYS],
    [['bridge', 'gateway', 'keys'], GATEWAY_KEYS],
    [['bridge', 'auth', 'keys'], AUTH_KEYS],
    [['bridge', 'humanApproval', 'keys'], HUMAN_APPROVAL_KEYS],
    [['bridge', 'agentServer', 'keys'], AGENT_SERVER_KEYS],
  ];
  for (const [path, expected] of exactArrays) {
    const keys = /** @type {string[]} */ (path);
    const values = /** @type {string[]} */ (expected);
    if (!isExactStringArray(valueAt(receipt, keys), values)) {
      return { ok: false, reason: `${keys.join('.')} does not match the closed capability surface` };
    }
  }

  for (const path of [
    ['bridge', 'frozen'],
    ['bridge', 'gateway', 'frozen'],
    ['bridge', 'auth', 'frozen'],
    ['bridge', 'humanApproval', 'frozen'],
    ['bridge', 'agentServer', 'frozen'],
  ]) {
    if (valueAt(receipt, path) !== true) return { ok: false, reason: `${path.join('.')} must be true` };
  }
  if (valueAt(receipt, ['bridge', 'nodeExposed']) !== false) {
    return { ok: false, reason: 'bridge.nodeExposed must be false' };
  }
  if (!Number.isInteger(valueAt(receipt, ['bridge', 'value', 'version']))) {
    return { ok: false, reason: 'bridge.value.version must be an integer' };
  }
  for (const denial of DENIAL_KEYS) {
    if (valueAt(receipt, ['denials', denial]) !== true) {
      return { ok: false, reason: `denials.${denial} must be true` };
    }
  }
  return { ok: true };
}
