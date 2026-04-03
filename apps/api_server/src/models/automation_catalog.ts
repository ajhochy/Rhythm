import type {
  AutomationActionType,
  AutomationRuleSource,
  AutomationTriggerKey,
} from './automation_rule';

export interface AutomationTriggerCatalogItem {
  key: AutomationTriggerKey;
  source: AutomationRuleSource;
  label: string;
  description: string;
  signalTypes: string[];
  configSchema: Record<string, unknown>;
}

export interface AutomationActionCatalogItem {
  key: AutomationActionType;
  label: string;
  description: string;
  configSchema: Record<string, unknown>;
}

export interface AutomationProviderCatalogItem {
  source: AutomationRuleSource;
  label: string;
  description: string;
  syncSupport: 'manual' | 'scheduled' | 'push_capable';
  triggerKeys: AutomationTriggerKey[];
}
