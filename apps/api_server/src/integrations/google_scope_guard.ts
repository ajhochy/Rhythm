import type { IntegrationAccount } from '../models/integration_account';

/** Thrown when the stored Google credential lacks the scope a tool needs. The
 *  broker controller maps this to a structured 409 { code: 'needs_scope_upgrade' }. */
export class NeedsScopeUpgradeError extends Error {
  constructor(public readonly requiredScope: string) {
    super(`needs_scope_upgrade: ${requiredScope}`);
    this.name = 'NeedsScopeUpgradeError';
  }
}

/**
 * Asserts the account's stored scope string contains `scope` as an exact
 * whitespace-delimited token.
 *
 * Google scopes are space-separated. Using exact-token matching means that
 * `https://www.googleapis.com/auth/calendar.readonly` does NOT satisfy a
 * requirement for `https://www.googleapis.com/auth/calendar` (they are
 * different tokens), which is the correct behaviour for the write-scope guard.
 */
export function assertScope(account: IntegrationAccount, scope: string): void {
  const granted = (account.scope ?? '').split(/\s+/);
  if (!granted.includes(scope)) {
    throw new NeedsScopeUpgradeError(scope);
  }
}
