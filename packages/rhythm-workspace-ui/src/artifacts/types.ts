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
