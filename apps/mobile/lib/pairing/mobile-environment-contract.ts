export interface MobileEnvironmentGrant {
  environmentId: string;
  hostId: string;
  deviceId: string;
  deviceToken: string;
  gatewayBaseUrl: string;
}

export type AccountBootstrapState =
  | 'idle'
  | 'discovering'
  | 'environmentSelection'
  | 'noAuthorizedComputer'
  | 'retryableError'
  | 'error'
  | 'unsupported';

export function isAccountBootstrapFailure(state: AccountBootstrapState): boolean {
  return ['noAuthorizedComputer', 'retryableError', 'error', 'unsupported']
    .includes(state);
}

export function parseMobileEnvironmentGrant(
  value: unknown,
  environmentId: string,
  parseGatewayBaseUrl: (value: unknown) => string,
  invalidGrant: () => Error = () => new Error(
    'Rhythm Cloud returned an invalid device grant.',
  ),
): MobileEnvironmentGrant {
  if (!value || typeof value !== 'object') throw invalidGrant();
  const grant = value as Partial<MobileEnvironmentGrant>;
  if (
    grant.environmentId !== environmentId ||
    typeof grant.hostId !== 'string' || !grant.hostId ||
    typeof grant.deviceId !== 'string' || !grant.deviceId ||
    typeof grant.deviceToken !== 'string' || !grant.deviceToken
  ) {
    throw invalidGrant();
  }
  return {
    environmentId,
    hostId: grant.hostId,
    deviceId: grant.deviceId,
    deviceToken: grant.deviceToken,
    gatewayBaseUrl: parseGatewayBaseUrl(grant.gatewayBaseUrl),
  };
}
