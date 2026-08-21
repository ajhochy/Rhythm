// Artifacts is a security-sensitive surface (shared files a workspace has produced or
// collected) and, per M1's scope, gets its own explicit port instead of folding into
// RhythmDomainGateway. A host that never passes `artifactsGateway` to <ArtifactsScreen/>
// gets a permanently locked screen — no accidental exposure through a shared context, no
// default-on network access.

export type RhythmArtifactKind = 'document' | 'image' | 'other';

export interface RhythmArtifact {
  id: string;
  title: string;
  kind: RhythmArtifactKind;
}

export interface ArtifactsGateway {
  list(): Promise<RhythmArtifact[]>;
}

/** A host-sanitized, immutable artifact bundle.  This package never receives a
 * URL, credential, filesystem path, or transport handle. */
export interface ArtifactHostDocument {
  artifactId: string;
  sessionId: string;
  bundleGeneration: string;
  stateGeneration: string;
  bodyHtml: string;
  styleText: string;
  scriptText: string;
  capabilities: readonly ArtifactHostCapability[];
}

/** The renderer may request only these named, host-mediated operations. */
export type ArtifactHostCapability = 'state.get' | 'state.update' | 'pco.services.read';

export interface ArtifactHostCapabilityMessage {
  type: 'rhythm-artifact-capability';
  requestId: string;
  frameId: string;
  artifactId: string;
  sessionId: string;
  bundleGeneration: string;
  stateGeneration: string;
  capability: ArtifactHostCapability;
  payload: unknown;
}

/** `conflict` is deliberately relayed unchanged so existing independent bundle
 * and state optimistic-concurrency behavior stays owned by the host. */
export interface ArtifactHostCapabilityResult {
  status: 'ok' | 'conflict' | 'rejected' | 'error';
  payload?: unknown;
  bundleGeneration?: string;
  stateGeneration?: string;
}

/** Explicit opt-in bridge.  Opening supplies an already-sanitized document and
 * receiving a message is the only way an artifact can request host authority. */
export interface ArtifactHostPort {
  open(artifactId: string): Promise<ArtifactHostDocument>;
  receive(message: ArtifactHostCapabilityMessage): Promise<ArtifactHostCapabilityResult>;
}
