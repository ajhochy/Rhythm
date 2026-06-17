import { WebSocket, type RawData } from 'ws';
import { OPENCODE_ENGINE_PORT } from './opencode_client_service';
import { logger } from '../utils/logger';

export function ptyEngineUrl(id: string): string {
  return `ws://127.0.0.1:${OPENCODE_ENGINE_PORT}/pty/${id}/connect`;
}

type WsCtor = (url: string) => WebSocket;

export function bridgePty(clientWs: WebSocket, engineUrl: string, wsCtor: WsCtor = (u) => new WebSocket(u)): void {
  const engine = wsCtor(engineUrl);
  engine.on('message', (data: RawData, isBinary: boolean) => {
    if (isBinary) return; // swallow opencode's leading \x00{cursor} control frame
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data.toString());
  });
  clientWs.on('message', (data: RawData) => {
    if (engine.readyState === WebSocket.OPEN) engine.send(data.toString());
  });
  const closeBoth = () => {
    if (engine.readyState === WebSocket.OPEN || engine.readyState === WebSocket.CONNECTING) { try { engine.close(); } catch { /* ignore */ } }
    if (clientWs.readyState === WebSocket.OPEN) { try { clientWs.close(); } catch { /* ignore */ } }
  };
  engine.on('close', closeBoth);
  engine.on('error', (e: Error) => { logger.warn(`[pty_proxy] engine ws error: ${e.message}`); closeBoth(); });
  clientWs.on('close', closeBoth);
  clientWs.on('error', closeBoth);
}
