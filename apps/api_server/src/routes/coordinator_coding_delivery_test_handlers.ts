import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app_error';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { createDeliveryOnlyFixture, readDeliveryTestState, releaseDeliveryHold, updateDeliveryFixtureControl } from '../services/coordinator_coding_delivery_controls';
import { asyncDelegationCompletionService } from '../services/async_delegation_completion_service';

function actor(req:Request) {
  if (!req.auth) throw AppError.unauthorized('Missing bearer token');
  const root=new AgentSessionsRepository().findById(req.params.id);
  if (!root || root.ownerUserId!==req.auth.user.id || !root.projectId) throw AppError.notFound('AgentSession');
  return {ownerUserId:req.auth.user.id,projectId:root.projectId};
}
const emptyBody=(req:Request)=>{if(req.body!=null && (typeof req.body!=='object' || Array.isArray(req.body) || Object.keys(req.body).length)) throw AppError.badRequest('No caller-supplied result/authority fields');};
export const codingDeliveryTestHandlers={
  async fixture(req:Request,res:Response,next:NextFunction){try{emptyBody(req);const scope=actor(req);const operationId=createDeliveryOnlyFixture(req.params.id,scope);
    await asyncDelegationCompletionService.onParentIdle(req.params.id);res.json(readDeliveryTestState(req.params.id,scope));}catch(e){next(e);}},
  async release(req:Request,res:Response,next:NextFunction){try{emptyBody(req);const scope=actor(req);releaseDeliveryHold(req.params.id,scope);
    await asyncDelegationCompletionService.onParentIdle(req.params.id);res.json(readDeliveryTestState(req.params.id,scope));}catch(e){next(e);}},
  async recover(req:Request,res:Response,next:NextFunction){try{emptyBody(req);const scope=actor(req);readDeliveryTestState(req.params.id,scope);
    await asyncDelegationCompletionService.onParentIdle(req.params.id);res.json(readDeliveryTestState(req.params.id,scope));}catch(e){next(e);}},
  state(req:Request,res:Response,next:NextFunction){try{res.json(readDeliveryTestState(req.params.id,actor(req)));}catch(e){next(e);}},
  async control(req:Request,res:Response,next:NextFunction){try{const scope=actor(req);updateDeliveryFixtureControl(req.params.id,scope,req.body);
    await asyncDelegationCompletionService.onParentIdle(req.params.id);res.json(readDeliveryTestState(req.params.id,scope));}catch(e){next(e);}},
};
