import { Router } from 'express';
import { PcoBrokerController } from '../controllers/pco_broker_controller';
import { requireAuth } from '../middleware/auth_middleware';

const controller = new PcoBrokerController();
export const pcoBrokerRouter = Router();

pcoBrokerRouter.use(requireAuth);

pcoBrokerRouter.get(
  '/service-types',
  controller.listServiceTypes.bind(controller),
);
pcoBrokerRouter.get(
  '/service-types/:serviceTypeId/plans',
  controller.listPlans.bind(controller),
);
pcoBrokerRouter.get(
  '/service-types/:serviceTypeId/plans/:planId/items',
  controller.listPlanItems.bind(controller),
);
pcoBrokerRouter.get(
  '/service-types/:serviceTypeId/plans/:planId/needed-positions',
  controller.listNeededPositions.bind(controller),
);
pcoBrokerRouter.patch(
  '/service-types/:serviceTypeId/plans/:planId/items/:itemId',
  controller.updatePlanItem.bind(controller),
);
pcoBrokerRouter.post(
  '/plans/:planId/team-members',
  controller.assignPersonToPlan.bind(controller),
);
pcoBrokerRouter.patch(
  '/plans/:planId/team-members/:memberId',
  controller.updateScheduledPerson.bind(controller),
);
