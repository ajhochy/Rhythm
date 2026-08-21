import { isAutoPromotionFeatureAvailable } from "../config/env";
import { AppError } from "../errors/app_error";
import type { PromotionTrustState } from "../models/promotion_trust_state";
import { PromotionTrustStateRepository } from "../repositories/promotion_trust_state_repository";

// Re-export the single production availability source for the later execution
// gate (#1441). That gate must not duplicate this env parsing.
export { isAutoPromotionFeatureAvailable as getAutoPromotionFeatureAvailability } from "../config/env";

/** Exact, code-owned acknowledgement for both enable and emergency disable. */
export const AUTO_PROMOTION_CONFIRMATION_HEADER =
  "X-Rhythm-Auto-Promotion-Confirmation";
export const AUTO_PROMOTION_CONFIRMATION_VALUE = "enable-auto-promotion";

export interface AutoPromotionSettingsState {
  availability: boolean;
  state: PromotionTrustState;
}

/**
 * D4.4 durable settings boundary. #1441 must import
 * `isAutoPromotionFeatureAvailable` from config/env.ts for its production
 * execution gate; this service remains the only API/UI reader of that source.
 */
export class AutoPromotionSettingsService {
  constructor(
    private readonly repository = new PromotionTrustStateRepository(),
    private readonly availability = isAutoPromotionFeatureAvailable,
  ) {}

  async getStateAsync(): Promise<AutoPromotionSettingsState> {
    return {
      availability: this.availability(),
      state: await this.repository.getSingletonAsync(),
    };
  }

  async setEnabledAsync(
    enabled: boolean,
    confirmation: string | undefined,
  ): Promise<AutoPromotionSettingsState> {
    if (confirmation !== AUTO_PROMOTION_CONFIRMATION_VALUE) {
      throw AppError.forbidden(
        "Explicit auto-promotion confirmation is required",
      );
    }

    if (!enabled) {
      return {
        availability: this.availability(),
        state: await this.repository.disableAutoPromotionAsync(),
      };
    }

    if (!this.availability()) {
      throw AppError.conflict("Auto-promotion is unavailable on this server");
    }

    const enabledState = await this.repository.enableAutoPromotionAsync(
      new Date().toISOString(),
    );
    if (!enabledState) {
      throw AppError.conflict(
        "Auto-promotion requires current eligibility and zero regressions",
      );
    }
    return { availability: true, state: enabledState };
  }
}
