import { useEffect, useRef, useState } from 'react';
import { ScreenRoot } from '../screens/ScreenRoot';
import type { ArtifactHostCapability, ArtifactHostCapabilityMessage, ArtifactHostDocument, ArtifactHostPort, ArtifactsGateway, RhythmArtifact } from './types';

export interface ArtifactsScreenProps {
  /** Deliberately optional and separate from RhythmDomainGateway — a host must pass this
   * explicitly to unlock the screen. See src/artifacts/types.ts. */
  artifactsGateway?: ArtifactsGateway;
  /** Kept separate from list access: an artifact gets no renderer bridge until
   * its host explicitly supplies this capability port. */
  artifactHostPort?: ArtifactHostPort;
}

const CAPABILITIES: readonly ArtifactHostCapability[] = ['state.get', 'state.update', 'pco.services.read'];
const MAX_BRIDGE_PAYLOAD_BYTES = 1024 * 1024;

function inline(value: string, closingTag: string): string {
  return value.replace(new RegExp(`</${closingTag}`, 'gi'), `<\\/${closingTag}`);
}

function documentSource(document: ArtifactHostDocument, nonce: string): string {
  const csp = `default-src 'none'; base-uri 'none'; connect-src 'none'; form-action 'none'; frame-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; object-src 'none'; worker-src 'none'; manifest-src 'none'; navigate-to 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'`;
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style nonce="${nonce}">${inline(document.styleText, 'style')}</style>${document.bodyHtml}<script nonce="${nonce}">${inline(document.scriptText, 'script')}</script>`;
}

function isCapabilityMessage(value: unknown): value is ArtifactHostCapabilityMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return message.type === 'rhythm-artifact-capability'
    && ['requestId', 'frameId', 'artifactId', 'sessionId', 'bundleGeneration', 'stateGeneration'].every((key) => typeof message[key] === 'string' && message[key].length > 0)
    && typeof message.capability === 'string' && CAPABILITIES.includes(message.capability as ArtifactHostCapability)
    && isBoundedJson(message.payload);
}

function isBoundedJson(value: unknown): boolean {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_BRIDGE_PAYLOAD_BYTES;
  } catch {
    return false;
  }
}

function documentIsBound(document: ArtifactHostDocument, artifactId: string): boolean {
  return document.artifactId === artifactId
    && [document.sessionId, document.bundleGeneration, document.stateGeneration].every((value) => value.length > 0)
    && document.capabilities.every((capability) => CAPABILITIES.includes(capability));
}

function createNonce(): string | null {
  if (!globalThis.crypto?.getRandomValues) return null;
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function ArtifactsScreen({ artifactsGateway, artifactHostPort }: ArtifactsScreenProps) {
  const [items, setItems] = useState<RhythmArtifact[]>([]);
  const [opened, setOpened] = useState<ArtifactHostDocument | null>(null);
  const [error, setError] = useState(false);
  const [frameId, setFrameId] = useState('');
  const [nonce, setNonce] = useState('');
  const frame = useRef<HTMLIFrameElement | null>(null);
  const nextFrameId = useRef(0);
  const openAttempt = useRef(0);
  const seenRequestIds = useRef(new Set<string>());

  useEffect(() => {
    if (!artifactsGateway) return;
    let cancelled = false;
    void artifactsGateway.list().then((loaded) => {
      if (!cancelled) { setItems(loaded); setError(false); }
    }).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => {
      cancelled = true;
    };
  }, [artifactsGateway]);

  useEffect(() => {
    if (!opened || !artifactHostPort || !frameId) return;
    const onMessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (!isCapabilityMessage(message) || event.origin !== 'null' || event.source !== frame.current?.contentWindow) return;
      if (message.frameId !== frameId || message.artifactId !== opened.artifactId || message.sessionId !== opened.sessionId
        || message.bundleGeneration !== opened.bundleGeneration || message.stateGeneration !== opened.stateGeneration
        || !opened.capabilities.includes(message.capability) || seenRequestIds.current.has(message.requestId)) return;
      seenRequestIds.current.add(message.requestId);
      const source = event.source;
      if (!source) return;
      void artifactHostPort.receive(message).then((result) => {
        if (source === frame.current?.contentWindow) {
          source.postMessage({ type: 'rhythm-artifact-capability-result', requestId: message.requestId, frameId, artifactId: opened.artifactId, sessionId: opened.sessionId, bundleGeneration: opened.bundleGeneration, stateGeneration: opened.stateGeneration, ...result }, '*');
        }
      }).catch(() => {
        if (source === frame.current?.contentWindow) {
          source.postMessage({ type: 'rhythm-artifact-capability-result', requestId: message.requestId, frameId, artifactId: opened.artifactId, sessionId: opened.sessionId, bundleGeneration: opened.bundleGeneration, stateGeneration: opened.stateGeneration, status: 'error' }, '*');
        }
      });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [artifactHostPort, frameId, opened]);

  const openArtifact = (artifactId: string) => {
    if (!artifactHostPort) return;
    setError(false);
    const attempt = ++openAttempt.current;
    void artifactHostPort.open(artifactId).then((document) => {
      const nextNonce = createNonce();
      if (attempt !== openAttempt.current || !nextNonce || !documentIsBound(document, artifactId)) return;
      nextFrameId.current += 1;
      seenRequestIds.current.clear();
      setFrameId(`rhythm-artifact-frame-${nextFrameId.current}`);
      setNonce(nextNonce);
      setOpened(document);
    }).catch(() => {
      if (attempt === openAttempt.current) setError(true);
    });
  };

  return (
    <ScreenRoot
      screenName="Artifacts"
      testId="rhythm-artifacts-screen"
      extraDataAttributes={{ 'data-rhythm-artifacts-state': artifactsGateway ? 'unlocked' : 'locked' }}
    >
      <h1>Artifacts</h1>
      {error ? <p role="alert" data-testid="rhythm-artifacts-error">Artifacts are temporarily unavailable.</p> : null}
      {artifactsGateway ? (
        <>
        <ul data-testid="rhythm-artifacts-list">
          {items.map((artifact) => (
            <li key={artifact.id} data-testid={`rhythm-artifact-row-${artifact.id}`}>
              {artifactHostPort ? <button type="button" onClick={() => openArtifact(artifact.id)} data-testid={`rhythm-artifact-open-${artifact.id}`}>{artifact.title}</button> : artifact.title}
            </li>
          ))}
        </ul>
        {opened && frameId && nonce ? <iframe ref={frame} title={opened.artifactId} data-testid="rhythm-artifact-frame" data-frame-id={frameId} sandbox="allow-scripts" srcDoc={documentSource(opened, nonce)} /> : null}
        </>
      ) : (
        <p role="status">Artifacts are locked until the host explicitly grants this security gate.</p>
      )}
    </ScreenRoot>
  );
}
