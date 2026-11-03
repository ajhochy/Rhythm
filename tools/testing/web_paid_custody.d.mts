export interface PaidCustodyReceipt {
  schemaVersion: 1;
  kind: 'web-paid-custody-v1';
  checkoutRoot: string;
  sourceRevision: string;
  sourceSha256: string;
  builtAt: number;
  artifacts: Record<'api' | 'mcp' | 'web' | 'engine', { path: string; sha256: string }>;
  fixtureRoot: string;
  manifestPath: string;
  sourceRoot: string;
  sourceRootSha256: string;
  apiBuildIdentitySha256: string;
  ports: { api: number; engine: number; gateway: number };
  caseIds: number[];
  provider: 'openai' | 'anthropic';
  issuedAt: number;
  stopAt: number;
  expires: number;
  orgSeedReceiptSha256?: string;
}
export function validatePaidReceipt(path: string, options?: { checkoutRoot?: string; expectedRevision?: string; now?: number }): PaidCustodyReceipt;
export function digestArtifact(path: string): string;
export function stableOwnedBytes(path: string, options?: { privateFile?: boolean }): {
  bytes: Buffer;
  identity: { dev: number; ino: number; uid: number; mode: number; size: number; mtimeMs: number };
};
