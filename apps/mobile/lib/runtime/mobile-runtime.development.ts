import type { MobileRuntimeVariant } from './mobile-runtime-types';

export const mobileRuntimeVariant: MobileRuntimeVariant = {
  enabled: false,
  serverUrl: 'http://127.0.0.1:4096',
  accountUser: null,
  cacheScope: null,
  simulatedPairingTestId: null,
  createPairedHostStore: () => null,
  createActivityTransport: () => null,
  createRhythmToolsService: () => null,
  simulatedPairingPayload: () => null,
};
