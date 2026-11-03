/** Internal-only fixture contract. It is deliberately not a claim about Dayflow's CLI. */
export interface DayflowFixtureRecord {
  id?: unknown;
  start?: unknown;
  end?: unknown;
  summary?: unknown;
  category?: unknown;
}

export interface DayflowFixtureExport {
  contractVersion: 'fixture-v1';
  sourceInstanceId: string;
  records: DayflowFixtureRecord[];
}

export interface DayflowObservation {
  sourceInstanceId: string;
  recordId: string;
  revisionHash: string;
  observedStart: string;
  observedEnd?: string;
  dayKey: string;
  summary: string;
  category?: string;
  exportVersion: 'fixture-v1' | 'v2.6.0';
}

export interface DayflowCandidate extends DayflowObservation {
  candidateId: string;
}

export interface DayflowPreview {
  token: string;
  expiresAt: string;
  candidates: DayflowCandidate[];
  rejected: Array<{ recordIndex: number; reason: string }>;
}

export interface DayflowConfig {
  schemaVersion: 1;
  enabled: boolean;
  automaticImport: boolean;
  /** Private, server-side SQLite journal binding. It is never sent to the UI. */
  journalPath: string | null;
  /** Consent is bound to this exact selected file and supported schema. */
  journalBinding: DayflowJournalBinding | null;
  executablePath: string | null;
  sourceVersion: string | null;
  /** Generated locally and never taken from a Dayflow export. */
  sourceNamespace: string;
  /** Durable private rotation token for reader/consent invalidation. */
  qualificationGeneration: string;
  /**
   * A server-authenticated, explicitly granted source consent. It is never
   * accepted from a reader/tool request and is intentionally private config.
   * Revoked records remain durable so a later config read cannot mistake a
   * prior grant for fresh authority.
   */
  sourceConsent: DayflowSourceConsent | null;
  timezone: string | null;
  rolloverHour: 4;
  exclusions: string[];
  retentionDays: number | null;
  maxRecordsPerRun: number;
}

export interface DayflowSourceConsent {
  schemaVersion: 1;
  ownerUserId: number;
  projectId: string;
  authorizingSessionId: string;
  namespace: string;
  sourceInstance: string;
  configurationGeneration: string;
  consentGeneration: string;
  grantedAt: string;
  revokedAt?: string;
}

export interface DayflowJournalBinding {
  fileIdentity: string;
  schemaFingerprint: string;
}

export interface DayflowSource {
  read(): Promise<DayflowFixtureExport>;
}

export const DEFAULT_DAYFLOW_CONFIG: Omit<DayflowConfig, 'sourceNamespace' | 'qualificationGeneration'> = {
  schemaVersion: 1,
  enabled: false,
  automaticImport: false,
  journalPath: null,
  journalBinding: null,
  executablePath: null,
  sourceVersion: null,
  sourceConsent: null,
  timezone: null,
  rolloverHour: 4,
  exclusions: [],
  retentionDays: null,
  maxRecordsPerRun: 100,
};
