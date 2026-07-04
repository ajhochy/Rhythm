import { capabilityStatus, type CapabilityKey, type RhythmConfig } from '../../config/rhythm_config';
import type { CheckResult } from './types';

const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
  aiProvider: 'AI provider',
  fileOps: 'File Ops tool',
  terminal: 'Terminal tool',
  webSearch: 'Web search',
  browserAutomation: 'Browser automation',
  codeExecutionSandbox: 'Code execution sandbox',
  memoryCapture: 'Memory capture',
  messagingIntegrations: 'Messaging integrations',
};

/**
 * #879 — `rhythm doctor` awareness of Blank Slate capability status. Every
 * capability is reported `pass: true` here (this is a status report, not a
 * pass/fail gate — an intentionally disabled capability is not a problem to
 * fix) with `status` distinguishing 'ok' (explicitly enabled), 'disabled'
 * (explicitly turned off — shown as "Disabled (intentional)"), and
 * 'unconfigured' (never touched, i.e. not running in Blank Slate mode at
 * all, or a capability introduced after the user's last setup run).
 */
export function checkCapabilityStatus(config: RhythmConfig): CheckResult[] {
  return (Object.keys(CAPABILITY_LABELS) as CapabilityKey[]).map((key) => {
    const status = capabilityStatus(config, key);
    return {
      label: `Capability: ${CAPABILITY_LABELS[key]}`,
      pass: true,
      // CapabilityStatus ('enabled'/'disabled'/'unconfigured') maps onto
      // CheckResult.status ('ok'/'disabled'/'unconfigured') — 'enabled' is
      // this check's version of a plain pass.
      status: status === 'enabled' ? 'ok' : status,
    };
  });
}
