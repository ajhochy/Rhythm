import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";

import { AppError } from "../errors/app_error";
import { requireAuth } from "../middleware/auth_middleware";
import {
  AUTO_PROMOTION_CONFIRMATION_HEADER,
  AutoPromotionSettingsService,
} from "../services/auto_promotion_settings_service";

/**
 * Local-agent Settings surface. Unlike ordinary internal agent routes, this
 * route always requires an authenticated desktop user because it changes a
 * durable organization-wide autonomy decision.
 */
export const autoPromotionSettingsRouter = Router();

// Construct after the app/test database is initialized. More importantly, no
// startup-time in-memory fallback can become a hidden second trust singleton.
const settingsService = () => new AutoPromotionSettingsService();

autoPromotionSettingsRouter.use(requireAuth);

autoPromotionSettingsRouter.get(
  "/auto-promotion",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await settingsService().getStateAsync());
    } catch (error) {
      next(error);
    }
  },
);

autoPromotionSettingsRouter.post(
  "/auto-promotion",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled;
      if (typeof enabled !== "boolean") {
        throw AppError.badRequest("enabled must be a boolean");
      }
      res.json(
        await settingsService().setEnabledAsync(
          enabled,
          req.header(AUTO_PROMOTION_CONFIRMATION_HEADER) ?? undefined,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);
