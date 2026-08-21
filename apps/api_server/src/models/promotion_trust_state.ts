/**
 * D4.1 (#1439) — trust state gating automatic promotion (D4: Trust-gated
 * automatic promotion). Singleton: exactly one row exists, keyed by the
 * fixed id in promotion_trust_state_repository.ts.
 *
 * `autoPromotionEnabled` is the actual gate a later D4 issue may explicitly
 * opt into. D4.6 can only force it false after a durable regression; neither
 * D4.2 nor D4.6 can set it true.
 */
export interface PromotionTrustState {
  totalVerified: number;
  totalRegressions: number;
  autoPromotionEnabled: boolean;
  enabledAt: string | null;
  trustThreshold: number;
  /**
   * D4.2 (#1440) — durable eligibility, recorded by trust_counter_service.ts.
   * Additive column (default false). Reading true never enables
   * `autoPromotionEnabled` by itself — it is only ever consulted by a later
   * D4 issue that will make its own separate decision to flip the gate.
   */
  autoPromotionEligible: boolean;
  updatedAt: string;
}

export const DEFAULT_TRUST_THRESHOLD = 10;
