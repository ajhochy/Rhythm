export interface QualificationModelLoan {
  provider?: 'anthropic';
  accountPath: string;
  accountProjectionSha256: string;
  selectorSha256: string;
  issuedAt: number;
  expires: number;
  stopAt: number;
  decisionPath?: string;
  decisionSha256?: string;
  gridPath?: string;
  gridSha256?: string;
}
export interface QualificationManifest {
  schemaVersion: 1;
  sourceRevision: string;
  fixtureRoot: string;
  dbPath: string;
  ownerId: string;
  ownerUserId: number;
  tokenSha256: string;
  profileSeedPath?: string;
  publicUserSeed: { id: number; name: string; email: string; googleSub: string; timezone: string };
  syntheticActor: { tokenPath: string; expiresAt: string; modelLoan?: QualificationModelLoan };
}
export function readQualificationFixture(manifestPath: string, expectedRevision: string): { manifest: QualificationManifest; userDataPath: string };
export function createQualificationFixture(sourceRevision: string, options?: { hermesRuntimeRoot?: string | null; hermesBackendArtifactRoot?: string | null }): string;
