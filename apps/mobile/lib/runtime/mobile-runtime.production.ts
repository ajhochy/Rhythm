import type { MobileRuntimeVariant } from './mobile-runtime-types';

export const mobileRuntimeVariant: MobileRuntimeVariant = {
  enabled: false,
  // Production OpenCode traffic is supplied by the authenticated paired-host
  // transport. A non-routable HTTPS origin fails closed if that transport is
  // unavailable; production never falls back to a local cleartext engine.
  serverUrl: 'https://paired-mac.invalid',
  accountUser: null,
  cacheScope: null,
  simulatedPairingTestId: null,
  createPairedHostStore: () => null,
  createActivityTransport: () => null,
  createRhythmToolsService: () => null,
  simulatedPairingPayload: () => null,
};
