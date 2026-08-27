export interface OpencodeHealthClient {
  isReady: boolean;
  statusMessage: string;
  websearchConfigured: boolean;
}

export interface OpencodeHealthBridge {
  isLive: boolean;
}

export function buildOpencodeHealthPayload(
  client: OpencodeHealthClient,
  bridge: OpencodeHealthBridge,
): {
  status: 'ready' | 'unavailable';
  message: string;
  bridgeLive: boolean;
  websearchConfigured: boolean;
} {
  const bridgeLive = bridge.isLive !== false;
  return {
    status: client.isReady && bridgeLive ? 'ready' : 'unavailable',
    message: client.isReady && !bridgeLive
      ? 'Opencode engine ready, event bridge unavailable'
      : client.statusMessage,
    bridgeLive,
    websearchConfigured: client.websearchConfigured,
  };
}
