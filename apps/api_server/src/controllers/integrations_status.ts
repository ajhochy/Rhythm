import type {
  IntegrationAccount,
  IntegrationProvider,
} from '../models/integration_account';

export type DerivedStatus =
  | 'connected'
  | 'needs_reauth'
  | 'error'
  | 'disconnected';

export interface AccountStatus {
  status: DerivedStatus;
  needsReauth: boolean;
}

/**
 * Substrings that satisfy each provider's minimum capability. A stored scope
 * string "contains" the requirement when any listed substring is present.
 * google_calendar accepts read-only OR full calendar scope.
 */
const REQUIRED_SCOPE_SUBSTRINGS: Record<IntegrationProvider, string[]> = {
  google_calendar: [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar',
  ],
  gmail: [
    'https://www.googleapis.com/auth/gmail.metadata',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify',
  ],
  planning_center: ['services'],
};

function hasRequiredScope(
  provider: IntegrationProvider,
  scope: string | null,
): boolean {
  if (!scope) return false;
  return REQUIRED_SCOPE_SUBSTRINGS[provider].some((needle) =>
    scope.includes(needle),
  );
}

export function deriveAccountStatus(
  provider: IntegrationProvider,
  account: IntegrationAccount | null,
): AccountStatus {
  if (!account) return { status: 'disconnected', needsReauth: false };
  if (account.status === 'error') return { status: 'error', needsReauth: false };
  if (!account.refreshToken || !hasRequiredScope(provider, account.scope)) {
    return { status: 'needs_reauth', needsReauth: true };
  }
  return { status: 'connected', needsReauth: false };
}
