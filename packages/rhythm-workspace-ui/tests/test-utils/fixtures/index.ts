import type { RhythmDomainGateway } from '../../../src/domain/types';
import { fixtureAutomationsGateway } from './automations';
import { fixtureDashboardGateway } from './dashboard';
import { fixtureFacilitiesGateway } from './facilities';
import { fixtureIntegrationsGateway } from './integrations';
import { fixtureMessagesGateway } from './messages';
import { fixturePlannerGateway } from './planner';
import { fixtureProjectsGateway } from './projects';
import { fixtureRhythmsGateway } from './rhythms';
import { fixtureTasksGateway } from './tasks';

export * from './automations';
export * from './dashboard';
export * from './facilities';
export * from './integrations';
export * from './messages';
export * from './planner';
export * from './projects';
export * from './rhythms';
export * from './tasks';

/** A full, deterministic in-memory RhythmDomainGateway — every domain seeded with real,
 * richly-shaped fixture data (see each ./<screen>.ts). Used to mount any single screen in
 * isolation (a screen only reads its own domain's slice) while still satisfying the
 * composed-gateway contract every RhythmWorkspaceProvider requires. */
export function fixtureDomainGateway(): RhythmDomainGateway {
  return {
    dashboard: fixtureDashboardGateway(),
    tasks: fixtureTasksGateway(),
    planner: fixturePlannerGateway(),
    projects: fixtureProjectsGateway(),
    rhythms: fixtureRhythmsGateway(),
    messages: fixtureMessagesGateway(),
    facilities: fixtureFacilitiesGateway(),
    integrations: fixtureIntegrationsGateway(),
    automations: fixtureAutomationsGateway(),
  };
}
