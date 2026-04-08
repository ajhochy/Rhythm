import { Router } from 'express';
import { FacilitiesController } from '../controllers/facilities_controller';
import { requireAuth } from '../middleware/auth_middleware';

const controller = new FacilitiesController();
export const facilitiesRouter = Router();

facilitiesRouter.use(requireAuth);
facilitiesRouter.get('/', controller.getAll.bind(controller));
facilitiesRouter.get(
  '/reservations',
  controller.getAllReservations.bind(controller),
);
facilitiesRouter.post('/', controller.create.bind(controller));
facilitiesRouter.patch('/:id', controller.update.bind(controller));
facilitiesRouter.delete('/:id', controller.remove.bind(controller));
facilitiesRouter.get('/:id/reservations', controller.getReservations.bind(controller));
facilitiesRouter.get(
  '/:id/reservation-series',
  controller.getReservationSeries.bind(controller),
);
facilitiesRouter.post('/:id/reservations', controller.createReservation.bind(controller));
facilitiesRouter.post(
  '/:id/reservation-series',
  controller.createReservationSeries.bind(controller),
);
facilitiesRouter.patch(
  '/:id/reservations/:reservationId',
  controller.updateReservation.bind(controller),
);
facilitiesRouter.delete(
  '/:id/reservations/:reservationId',
  controller.deleteReservation.bind(controller),
);
