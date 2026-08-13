export type GatewayConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'desktop-offline';

export function deriveMacPresence(
  health: unknown,
): 'online' | 'offline' | 'unknown' {
  if (!health || typeof health !== 'object' || Array.isArray(health)) {
    return 'unknown';
  }

  const { macOnline } = health as Record<string, unknown>;
  if (macOnline === false) return 'offline';
  if (macOnline === true) return 'online';
  if (Object.prototype.hasOwnProperty.call(health, 'macOnline')) {
    return 'unknown';
  }

  // A reachable direct-gateway health response does not include macOnline.
  return 'online';
}

export function connectionStatusForPresence(
  base: GatewayConnectionStatus,
  presence: 'online' | 'offline' | 'unknown',
): GatewayConnectionStatus {
  return base === 'connected' && presence === 'offline'
    ? 'desktop-offline'
    : base;
}
