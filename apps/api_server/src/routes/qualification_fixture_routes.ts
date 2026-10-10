import { logger } from '../utils/logger';
import { Router } from 'express';
import { loadQualificationFixtureAuthority, qualificationFixtureTokenValid, qualificationApiBootId } from '../services/qualification_fixture_authority';
import { fixtureModes, type QualificationFixtureService } from '../services/qualification_fixture_service';
const knownCases=new Set(['dayflow-receiver','dayflow-revoked','dayflow-foreign','dayflow-history','dayflow-unenrolled','router-exhausted-auto','router-exhausted-pinned','router-exhausted-null','router-corrupt','coordinator-delivery']);
const stages=new Map([
  ['fixture stale or foreign','fixture_binding'],['fixture engine boot changed','engine_boot'],
  ['actual canonical context missing from provider input','provider_context'],['actual fixture provider handoff not observed','provider_handoff'],
  ['actual ordinary provider dispatch missing','ordinary_provider_handoff'],['actual retained exposure missing','retained_history'],
  ['actual first router policy did not select fixture account A','router_first_policy'],['genuine completed coding receipt required','completed_receipt'],
  ['genuine verified held receipt required','held_verified_receipt'],['actual completed-before-delivery runtime recovery required','receipt_recovery'],
  ['actual canonical delivery missing','canonical_delivery'],['ordinary root cannot rotate','primary_designation'],
  ['fixture primary rotation forbidden with real coding/approval authority','active_authority'],
]);
function reportFailure(error:unknown,fixtureId?:string,caseName?:string):string {
  const refusal=error instanceof Error?stages.get(error.message)??'production_dependency_refused':'production_dependency_refused';
  logger.warn('[qualification-fixture] '+JSON.stringify({fixtureId:fixtureId && /^[a-f0-9-]{36}$/.test(fixtureId)?fixtureId:'unbound',caseName:caseName && knownCases.has(caseName)?caseName:'setup',refusal}));
  return refusal;
}
/** Available only under immutable, private, build-bound startup authority. */
export function createQualificationFixtureRouter(service:QualificationFixtureService):Router {
  const router=Router();
  router.use((req,res,next)=>{if(!qualificationFixtureTokenValid(req.headers.authorization)){res.status(403).json({error:'qualification_authority_required'});return;}next();});
  router.get('/capability',async(_req,res)=>{try{res.json(await service.capability());}catch(error){res.status(503).json({error:'qualification_unavailable',refusal:reportFailure(error)});}});
  router.post('/',async(req,res)=>{
    const m=loadQualificationFixtureAuthority()!;
    if(req.body?.ownerId!==m.ownerId || req.body?.fixtureRoot!==m.fixtureRoot){res.status(403).json({error:'foreign_fixture_scope'});return;}
    if(!fixtureModes.includes(req.body?.mode) || typeof req.body?.requestId!=='string' || !req.body.requestId || req.body.requestId.length>256){res.status(400).json({error:'invalid_request'});return;}
    try{const f=await service.create(req.body.mode);res.status(201).json({id:f.id});}catch(error){res.status(409).json({error:'fixture_creation_held',refusal:reportFailure(error)});}
  });
  router.post('/:id/cases/:caseName',async(req,res)=>{
    if(req.body?.expectedBootId && req.body.expectedBootId!==qualificationApiBootId){res.status(409).json({error:'stale_fixture_boot'});return;}
    try{res.json(await service.runCase(String(req.params.id),String(req.params.caseName)));}catch(error){res.status(409).json({error:'fixture_case_held',refusal:reportFailure(error,String(req.params.id),String(req.params.caseName))});}
  });
  router.post('/coordinator-intake',(_req,res)=>{try{service.clearDayflowDesignationForCoordinator();res.json({ready:true});}catch{res.status(409).json({error:'fixture_intake_held'});}});
  return router;
}
