const DEFAULT_MOBILE_GATEWAY_PORT = 4002;

export function mobileGatewayListenPort(): number {
  const raw = process.env.RHYTHM_MOBILE_GATEWAY_PORT?.trim();
  if (!raw) return DEFAULT_MOBILE_GATEWAY_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error('RHYTHM_MOBILE_GATEWAY_PORT must be a port from 1024 to 65535');
  }
  return port;
}

export function mobileGatewayServeTarget(): string {
  return `http://127.0.0.1:${mobileGatewayListenPort()}`;
}

export function acceptedMobileGatewayServeTargets(): ReadonlySet<string> {
  const port = mobileGatewayListenPort();
  return new Set([
    `http://127.0.0.1:${port}`,
  ]);
}
