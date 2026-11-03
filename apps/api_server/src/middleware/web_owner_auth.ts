import type { RequestHandler } from 'express';
import { webHostOwner } from '../services/web_host';
import { requireLocalOrCloudAuth } from './auth_middleware';

/** Opt-in only for Coordinator and the shared catalog after the web Host/Origin guard. */
export const requireWebOwnerOrLocalOrCloudAuth: RequestHandler = (req, res, next) => {
  try {
    // A present header always keeps its existing bearer semantics, including
    // invalid/empty headers. It must never inherit the configured web owner.
    if (req.headers.authorization === undefined) {
      const owner = webHostOwner();
      if (owner && req.auth?.sessionToken === '' && req.auth.user === owner) {
        next();
        return;
      }
    }
    void requireLocalOrCloudAuth(req, res, next);
  } catch (error) { next(error); }
};
