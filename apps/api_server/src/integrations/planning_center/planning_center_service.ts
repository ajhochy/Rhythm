import { AppError } from '../../errors/app_error';
import { env } from '../../config/env';
import type { IntegrationAccount } from '../../models/integration_account';
import type {
  PlanningCenterTeamOption,
  PlanningCenterTaskOptions,
  PlanningCenterTaskPreferences,
} from '../../models/planning_center_task_preferences';

interface JsonApiResource {
  id: string;
  type?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { id?: string } | null }>;
}

interface JsonApiResponse {
  data?: JsonApiResource[];
}

interface PlanningCenterTaskSignal {
  sourceId: string;
  title: string;
  notes: string | null;
  dueDate: string;
  scheduledDate: string;
  dedupeKey: string;
  teamId: string | null;
}

interface PlanningCenterProjectSignal {
  anchorDate: string;
  name: string;
  serviceTypeName: string;
  planId: string;
}

interface PlanningCenterAutomationSignals {
  tasks: PlanningCenterTaskSignal[];
  specialProjects: PlanningCenterProjectSignal[];
  planCount: number;
}

interface ServiceTypeSummary {
  id: string;
  name: string;
}

interface PlanSummary {
  id: string;
  serviceTypeId: string;
  serviceTypeName: string;
  title: string;
  planDate: string;
}

function roleKey(planId: string, positionName: string): string {
  return `${planId}:${positionName.trim().toLowerCase()}`;
}

function daysUntil(date: string): number {
  const today = new Date();
  const startOfTodayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const target = new Date(`${date}T00:00:00Z`).getTime();
  return Math.floor((target - startOfTodayUtc) / (1000 * 60 * 60 * 24));
}

function mondayOfServiceWeek(date: string): string {
  const target = new Date(`${date}T12:00:00Z`);
  const daysFromMonday = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - daysFromMonday);
  return target.toISOString().slice(0, 10);
}

function positionAllowed(
  positionName: string,
  preferences: PlanningCenterTaskPreferences,
): boolean {
  const normalized = positionName.trim().toLowerCase();
  const selectedPositions = preferences.positionNames.map((value) =>
    value.trim().toLowerCase(),
  );
  if (
    selectedPositions.length > 0 &&
    !selectedPositions.includes(normalized)
  ) {
    return false;
  }

  if (
    env.pcoIncludedPositionKeywords.length > 0 &&
    !env.pcoIncludedPositionKeywords.some((keyword) =>
      normalized.includes(keyword),
    )
  ) {
    return false;
  }

  if (
    env.pcoExcludedPositionKeywords.some((keyword) =>
      normalized.includes(keyword),
    )
  ) {
    return false;
  }

  return true;
}

function serviceTypeAllowed(
  serviceTypeName: string,
  _preferences: PlanningCenterTaskPreferences,
): boolean {
  return !env.pcoIgnoredServiceTypeKeywords.some((keyword) =>
    serviceTypeName.trim().toLowerCase().includes(keyword),
  );
}

function teamAllowed(
  teamId: string | null,
  preferences: PlanningCenterTaskPreferences,
): boolean {
  if (preferences.teamIds.length == 0) return true;
  if (!teamId) return false;
  if (!preferences.teamIds.includes(teamId)) {
    return false;
  }
  return true;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function isoDate(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

const SPECIAL_SERVICE_TEMPLATE_NAME = 'special service project';

export class PlanningCenterService {
  async collectAutomationSignals(
    account: IntegrationAccount,
    preferences: PlanningCenterTaskPreferences,
  ): Promise<PlanningCenterAutomationSignals> {
    if (!account.accessToken) {
      throw AppError.badRequest('Planning Center is not connected');
    }

    const serviceTypes = await this.fetchServiceTypes(account, preferences);
    const tasks: PlanningCenterTaskSignal[] = [];
    const specialProjects: PlanningCenterProjectSignal[] = [];
    let planCount = 0;

    for (const serviceType of serviceTypes) {
      const plans = await this.fetchUpcomingPlans(account, serviceType);
      planCount += plans.length;

      for (const plan of plans) {
        const planLeadDays = daysUntil(plan.planDate);
        const [neededSignals, declineSignals] = await Promise.all([
          planLeadDays <= env.pcoNeededTaskWindowDays
              ? this.fetchNeededPositionSignals(account, plan)
              .then((signals) =>
                signals.filter((signal) =>
                  teamAllowed(signal.teamId, preferences) &&
                  positionAllowed(signal.positionName, preferences),
                ),
              )
              : Promise.resolve([]),
          planLeadDays <= env.pcoDeclineTaskWindowDays
              ? this.fetchDeclineSignals(account, plan)
              .then((signals) =>
                signals.filter((signal) =>
                  teamAllowed(signal.teamId, preferences) &&
                  positionAllowed(signal.positionName, preferences),
                ),
              )
              : Promise.resolve([]),
        ]);
        const declinedKeys = new Set(
          declineSignals.map((signal) => signal.dedupeKey),
        );
        tasks.push(
          ...declineSignals,
          ...neededSignals.filter((signal) => !declinedKeys.has(signal.dedupeKey)),
        );

        const planDay = new Date(`${plan.planDate}T12:00:00Z`).getUTCDay();
        if (
          planDay !== 0 &&
          planLeadDays <= env.pcoSpecialProjectWindowDays
        ) {
          specialProjects.push({
            anchorDate: plan.planDate,
            name: plan.title,
            serviceTypeName: plan.serviceTypeName,
            planId: plan.id,
          });
        }
      }
    }

    return { tasks, specialProjects, planCount };
  }

  specialServiceTemplateName(): string {
    return SPECIAL_SERVICE_TEMPLATE_NAME;
  }

  async collectTaskOptions(
    account: IntegrationAccount,
  ): Promise<PlanningCenterTaskOptions> {
    if (!account.accessToken) {
      throw AppError.badRequest('Planning Center is not connected');
    }

    const serviceTypes = await this.fetchServiceTypes(account, {
      teamIds: [],
      positionNames: [],
    });
    const teams = await this.fetchTeamsByServiceType(account, serviceTypes);
    const positionsByTeamId = new Map<string, Set<string>>();

    for (const serviceType of serviceTypes) {
      const plans = await this.fetchUpcomingPlans(account, serviceType);
      for (const plan of plans) {
        const [neededPositions, declinedPositions] = await Promise.all([
          this.fetchNeededPositionSignals(account, plan),
          this.fetchDeclineSignals(account, plan),
        ]);
        for (const signal of [...neededPositions, ...declinedPositions]) {
          if (!signal.teamId) continue;
          const set = positionsByTeamId.get(signal.teamId) ?? new Set<string>();
          set.add(signal.positionName);
          positionsByTeamId.set(signal.teamId, set);
        }
      }
    }

    return {
      teams: teams.sort((a, b) => {
        const byServiceType = a.serviceTypeName.localeCompare(
          b.serviceTypeName,
        );
        if (byServiceType !== 0) return byServiceType;
        return a.name.localeCompare(b.name);
      }),
      positionsByTeamId: Object.fromEntries(
        [...positionsByTeamId.entries()].map(([teamId, values]) => [
          teamId,
          [...values].sort(),
        ]),
      ),
    };
  }

  private async fetchServiceTypes(
    account: IntegrationAccount,
    preferences: PlanningCenterTaskPreferences,
  ): Promise<ServiceTypeSummary[]> {
    const payload = await this.getJson(
      account,
      '/services/v2/service_types?per_page=100',
    );
    return (payload.data ?? [])
      .map((resource) => ({
        id: resource.id,
        name:
          asString(resource.attributes?.name) ??
          asString(resource.attributes?.title) ??
          'Service Type',
      }))
      .filter((serviceType) => serviceTypeAllowed(serviceType.name, preferences));
  }

  private async fetchTeamsByServiceType(
    account: IntegrationAccount,
    serviceTypes: ServiceTypeSummary[],
  ): Promise<PlanningCenterTeamOption[]> {
    const teams: PlanningCenterTeamOption[] = [];
    for (const serviceType of serviceTypes) {
      const payload = await this.getJson(
        account,
        `/services/v2/service_types/${serviceType.id}/teams?per_page=100`,
      );
      for (const resource of payload.data ?? []) {
        teams.push({
          id: resource.id,
          name:
            asString(resource.attributes?.name) ??
            asString(resource.attributes?.title) ??
            'Team',
          serviceTypeId: serviceType.id,
          serviceTypeName: serviceType.name,
        });
      }
    }
    return teams;
  }

  private async fetchUpcomingPlans(
    account: IntegrationAccount,
    serviceType: ServiceTypeSummary,
  ): Promise<PlanSummary[]> {
    const payload = await this.getJson(
      account,
      `/services/v2/service_types/${serviceType.id}/plans?filter=future&per_page=25`,
    );

    return (payload.data ?? [])
      .map((resource) => {
        const attrs = resource.attributes ?? {};
        const planDate =
          isoDate(asString(attrs.sort_date)) ??
          isoDate(asString(attrs.dates)) ??
          isoDate(asString(attrs.last_time_at));
        if (!planDate) return null;

        const title =
          asString(attrs.title) ??
          asString(attrs.series_title) ??
          asString(attrs.dates) ??
          `${serviceType.name} ${planDate}`;

        return {
          id: resource.id,
          serviceTypeId: serviceType.id,
          serviceTypeName: serviceType.name,
          title,
          planDate,
        };
      })
      .filter((plan): plan is PlanSummary => plan != null);
  }

  private async fetchNeededPositionSignals(
    account: IntegrationAccount,
    plan: PlanSummary,
  ): Promise<Array<PlanningCenterTaskSignal & { positionName: string }>> {
    const payload = await this.getJson(
      account,
      `/services/v2/service_types/${plan.serviceTypeId}/plans/${plan.id}/needed_positions?per_page=100`,
    );

    const signals: Array<PlanningCenterTaskSignal & { positionName: string }> =
      [];
    for (const resource of payload.data ?? []) {
      const attrs = resource.attributes ?? {};
      const positionName =
        asString(attrs.team_position_name) ??
        asString(attrs.name) ??
        asString(attrs.title) ??
        'needed position';
      const explicitNeeded =
        asNumber(attrs.needed_count) ??
        asNumber(attrs.open_count) ??
        asNumber(attrs.unfilled_count);
      const quantity = asNumber(attrs.quantity) ?? asNumber(attrs.quantity_needed);
      const filled =
        asNumber(attrs.filled_count) ??
        asNumber(attrs.team_members_count) ??
        asNumber(attrs.scheduled_count);
      const neededCount =
        explicitNeeded ?? ((quantity != null ? quantity : 0) - (filled ?? 0));

      if (neededCount <= 0) continue;

      signals.push({
        sourceId: `planning_center:needed:${plan.id}:${resource.id}`,
        title:
          neededCount > 1
              ? `Fill ${neededCount} ${positionName} spots for ${plan.title}`
              : `Fill ${positionName} for ${plan.title}`,
        notes:
          `Planning Center reports ${neededCount} unfilled ${positionName}` +
          ` slot${neededCount == 1 ? '' : 's'} for ${plan.serviceTypeName}` +
          ` on ${plan.planDate}.`,
        dueDate: plan.planDate,
        scheduledDate: mondayOfServiceWeek(plan.planDate),
        dedupeKey: roleKey(plan.id, positionName),
        teamId: resource.relationships?.team?.data?.id ?? null,
        positionName,
      });
    }

    return signals;
  }

  private async fetchDeclineSignals(
    account: IntegrationAccount,
    plan: PlanSummary,
  ): Promise<Array<PlanningCenterTaskSignal & { positionName: string }>> {
    const payload = await this.getJson(
      account,
      `/services/v2/service_types/${plan.serviceTypeId}/plans/${plan.id}/team_members?per_page=100`,
    );

    const declinesByRole = new Map<
      string,
      { positionName: string; people: string[]; ids: string[]; teamId: string | null }
    >();
    for (const resource of payload.data ?? []) {
      const attrs = resource.attributes ?? {};
      const status = (asString(attrs.status) ?? '').toLowerCase();
      if (status != 'declined' && status != 'd') continue;

      const personName =
        asString(attrs.person_name) ??
        asString(attrs.name) ??
        asString(attrs.team_member_name) ??
        'Someone';
      const positionName =
        asString(attrs.team_position_name) ??
        asString(attrs.position_name) ??
        'position';
      const key = roleKey(plan.id, positionName);
      const entry = declinesByRole.get(key) ?? {
        positionName,
        people: [],
        ids: [],
        teamId: resource.relationships?.team?.data?.id ?? null,
      };
      entry.people.push(personName);
      entry.ids.push(resource.id);
      declinesByRole.set(key, entry);
    }

    return [...declinesByRole.entries()].map(([key, entry]) => {
      const peopleLabel =
        entry.people.length == 1
            ? entry.people[0]
            : `${entry.people.length} people`;
      return {
        sourceId: `planning_center:declined:${plan.id}:${entry.ids.join('-')}`,
        title: `Replace ${entry.positionName} for ${plan.title}`,
        notes:
          `${peopleLabel} declined the ${entry.positionName} invitation` +
          ` in Planning Center for ${plan.serviceTypeName} on ${plan.planDate}.`,
        dueDate: plan.planDate,
        scheduledDate: mondayOfServiceWeek(plan.planDate),
        dedupeKey: key,
        teamId: entry.teamId,
        positionName: entry.positionName,
      };
    });
  }

  private async getJson(
    account: IntegrationAccount,
    path: string,
  ): Promise<JsonApiResponse> {
    const response = await fetch(`https://api.planningcenteronline.com${path}`, {
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'User-Agent': 'Rhythm (https://github.com/ajhochy/Rhythm)',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw AppError.badRequest(`Planning Center sync failed: ${text}`);
    }

    return (await response.json()) as JsonApiResponse;
  }
}
