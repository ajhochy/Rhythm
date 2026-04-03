export type IntegrationProvider =
  | 'google_calendar'
  | 'gmail'
  | 'planning_center';

export interface IntegrationAccount {
  id: string;
  ownerId: number | null;
  provider: IntegrationProvider;
  externalAccountId: string;
  email: string | null;
  displayName: string | null;
  status: 'connected' | 'error';
  accessToken: string | null;
  refreshToken: string | null;
  scope: string | null;
  tokenType: string | null;
  expiresAt: string | null;
  lastSyncedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}
