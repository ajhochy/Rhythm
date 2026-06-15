import type { NextFunction, Request, Response } from 'express';
import {
  PcoPermissionError,
  PlanningCenterService,
} from '../integrations/planning_center/planning_center_service';
import { IntegrationsService } from '../services/integrations_service';

const integrationsService = new IntegrationsService();
const planningCenter = new PlanningCenterService();

/**
 * Broker routes that expose PlanningCenterService read/write helpers to the
 * rhythm MCP server. Each handler resolves the stored planning_center account
 * (refreshing the token first), then calls the corresponding service method.
 * A PCO 403 surfaces as PcoPermissionError and is translated to HTTP 403 with a
 * machine-readable code so callers can distinguish a permission denial from a
 * generic failure.
 */
export class PcoBrokerController {
  private handle<T>(
    res: Response,
    next: NextFunction,
    work: () => Promise<T>,
  ): void {
    work()
      .then((result) => {
        res.json(result);
      })
      .catch((err) => {
        if (err instanceof PcoPermissionError) {
          res
            .status(403)
            .json({ code: 'pco_permission_denied', message: err.message });
          return;
        }
        next(err);
      });
  }

  listServiceTypes(req: Request, res: Response, next: NextFunction) {
    this.handle(res, next, async () => {
      const account = await integrationsService.ensureFreshPlanningCenterAccount(
        req.auth!.user.id,
      );
      return planningCenter.listServiceTypes(account);
    });
  }

  listPlans(req: Request, res: Response, next: NextFunction) {
    this.handle(res, next, async () => {
      const account = await integrationsService.ensureFreshPlanningCenterAccount(
        req.auth!.user.id,
      );
      return planningCenter.listPlans(account, req.params.serviceTypeId);
    });
  }

  listPlanItems(req: Request, res: Response, next: NextFunction) {
    this.handle(res, next, async () => {
      const account = await integrationsService.ensureFreshPlanningCenterAccount(
        req.auth!.user.id,
      );
      return planningCenter.listPlanItems(
        account,
        req.params.serviceTypeId,
        req.params.planId,
      );
    });
  }

  listNeededPositions(req: Request, res: Response, next: NextFunction) {
    this.handle(res, next, async () => {
      const account = await integrationsService.ensureFreshPlanningCenterAccount(
        req.auth!.user.id,
      );
      return planningCenter.listNeededPositions(
        account,
        req.params.serviceTypeId,
        req.params.planId,
      );
    });
  }

  updatePlanItem(req: Request, res: Response, next: NextFunction) {
    this.handle(res, next, async () => {
      const account = await integrationsService.ensureFreshPlanningCenterAccount(
        req.auth!.user.id,
      );
      const body = req.body as Record<string, unknown>;
      const attributes =
        body.attributes && typeof body.attributes === 'object'
          ? (body.attributes as Record<string, unknown>)
          : { title: body.title };
      return planningCenter.updatePlanItem(
        account,
        req.params.serviceTypeId,
        req.params.planId,
        req.params.itemId,
        attributes,
      );
    });
  }

  assignPersonToPlan(req: Request, res: Response, next: NextFunction) {
    this.handle(res, next, async () => {
      const account = await integrationsService.ensureFreshPlanningCenterAccount(
        req.auth!.user.id,
      );
      const { personId, teamId, positionName } = req.body as Record<
        string,
        string
      >;
      return planningCenter.assignPersonToPlan(
        account,
        req.params.planId,
        personId,
        teamId,
        positionName,
      );
    });
  }

  updateScheduledPerson(req: Request, res: Response, next: NextFunction) {
    this.handle(res, next, async () => {
      const account = await integrationsService.ensureFreshPlanningCenterAccount(
        req.auth!.user.id,
      );
      const { status } = req.body as Record<string, string>;
      return planningCenter.updateScheduledPerson(
        account,
        req.params.planId,
        req.params.memberId,
        status,
      );
    });
  }
}
