import type { Request, Response, Router } from 'express';

import type { RuntimeReportRequest } from '../bridge_schema';
import {
  BRIDGE_RATE_LIMITS,
  bridgeGrant,
  grantRateLimit,
  hasOnlyKeys,
  isJsonObject,
  runtime,
  sendBridgeError,
  type BridgeDeps,
} from './common';

const REPORT_KEYS = new Set([
  'hermesVersion', 'pluginVersion', 'providers', 'reasoningEfforts', 'terminalBackend',
]);

function validRuntimeReport(body: unknown): body is RuntimeReportRequest {
  return isJsonObject(body)
    && hasOnlyKeys(body, REPORT_KEYS)
    && typeof body.hermesVersion === 'string' && body.hermesVersion.length >= 1 && body.hermesVersion.length <= 64
    && typeof body.pluginVersion === 'string' && body.pluginVersion.length >= 1 && body.pluginVersion.length <= 32
    && Array.isArray(body.providers) && body.providers.length <= 32
    && body.providers.every((provider) => isJsonObject(provider)
      && hasOnlyKeys(provider, new Set(['id', 'ready']))
      && typeof provider.id === 'string' && provider.id.length >= 1 && provider.id.length <= 64
      && typeof provider.ready === 'boolean')
    && Array.isArray(body.reasoningEfforts) && body.reasoningEfforts.length <= 16
    && body.reasoningEfforts.every((effort) => typeof effort === 'string' && effort.length >= 1 && effort.length <= 32)
    && ['local', 'container', 'remote', 'unknown'].includes(String(body.terminalBackend));
}

function runtimeReportHandler(
  req: Request<Record<string, never>, void, RuntimeReportRequest>,
  res: Response,
): void {
  if (!validRuntimeReport(req.body)) {
    sendBridgeError(res, 400, 'bridge_invalid_request');
    return;
  }
  const grant = bridgeGrant(res);
  grant.report = req.body;
  res.sendStatus(204);
}

export function register(router: Router, _deps: BridgeDeps): void {
  router.post(
    '/runtime/report',
    runtime('runtime.report'),
    grantRateLimit('runtime.report', BRIDGE_RATE_LIMITS.runtimeReportPerMinute),
    runtimeReportHandler,
  );
}
