import type { RhythmUser } from '@/lib/auth/rhythm-session-store';
import type { PairedHostStore } from '@/lib/pairing/paired-host-store';
import type { ActivityTransport } from '@/providers/services/activity-service';
import type { RhythmToolsService } from '@/providers/services/rhythm-tools-service';

/**
 * Build-variant boundary for deterministic browser automation.
 *
 * Metro resolves `@rhythm/mobile-runtime` to either the production or E2E
 * implementation. Production bundles therefore contain only the inert
 * implementation and cannot carry fake identities, credentials, control
 * routes, or gateway overrides.
 */
export interface MobileRuntimeVariant {
  enabled: boolean;
  serverUrl: string;
  accountUser: RhythmUser | null;
  cacheScope: string | null;
  simulatedPairingTestId: string | null;
  createPairedHostStore(): PairedHostStore | null;
  createActivityTransport(): ActivityTransport | null;
  createRhythmToolsService(): RhythmToolsService | null;
  simulatedPairingPayload(hasExistingHost: boolean): string | null;
}
