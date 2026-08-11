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
  teamName: string | null;
  positionName: string;
  signalType: 'needed_position_open' | 'team_member_declined' | 'team_member_unconfirmed';
  serviceTypeName: string;
  planId: string;
  planTitle: string;
  planDate: string;
  daysUntil: number;
}

interface PlanningCenterProjectSignal {
  anchorDate: string;
  name: string;
  serviceTypeName: string;
  planId: string;
  title: string;
  daysUntil: number;
}

interface PlanningCenterPlanSignal {
  planId: string;
  title: string;
  serviceTypeName: string;
  planDate: string;
  daysUntil: number;
  publishedAt: string | null;
}

interface PlanningCenterAutomationSignals {
  tasks: PlanningCenterTaskSignal[];
  specialProjects: PlanningCenterProjectSignal[];
  upcomingPlans: PlanningCenterPlanSignal[];
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
  publishedAt: string | null;
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

export class PcoPermissionError extends Error {
  constructor(
    message = 'Insufficient Planning Center permissions for this action.',
  ) {
    super(message);
    this.name = 'PcoPermissionError';
  }
}

function pcoReadBaseUrl(): string {
  const override = process.env.RHYTHM_LIVE_E2E === '1' ? process.env.RHYTHM_PCO_LIVE_BASE_URL : undefined;
  if (override) {
    try {
      const url = new URL(override);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname) && !url.username && !url.password) return url.origin;
    } catch { /* production default below */ }
  }
  return 'https://api.planningcenteronline.com';
}

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
    const upcomingPlans: PlanningCenterPlanSignal[] = [];
    let planCount = 0;

    for (const serviceType of serviceTypes) {
      const plans = await this.fetchUpcomingPlans(account, serviceType);
      planCount += plans.length;

      for (const plan of plans) {
        const planLeadDays = daysUntil(plan.planDate);
        upcomingPlans.push({
          planId: plan.id,
          title: plan.title,
          serviceTypeName: plan.serviceTypeName,
          planDate: plan.planDate,
          daysUntil: planLeadDays,
          publishedAt: plan.publishedAt,
        });
        const [neededSignals, declineSignals, unconfirmedSignals] = await Promise.all([
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
          planLeadDays <= env.pcoDeclineTaskWindowDays
              ? this.fetchUnconfirmedSignals(account, plan)
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
          ...unconfirmedSignals.filter((signal) => !declinedKeys.has(signal.dedupeKey)),
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
            title: plan.title,
            daysUntil: planLeadDays,
          });
        }
      }
    }

    return { tasks, specialProjects, upcomingPlans, planCount };
  }

  async collectServiceItemSignals(
    account: IntegrationAccount,
  ): Promise<Array<{
    itemId: string;
    title: string;
    itemType: string;
    sequence: number;
    serviceTypeName: string;
    planId: string;
    planDate: string;
    daysUntil: number;
  }>> {
    if (!account.accessToken) {
      throw AppError.badRequest('Planning Center is not connected');
    }
    const serviceTypes = await this.fetchServiceTypes(account, {
      teamIds: [],
      positionNames: [],
    });
    const result: Array<{
      itemId: string;
      title: string;
      itemType: string;
      sequence: number;
      serviceTypeName: string;
      planId: string;
      planDate: string;
      daysUntil: number;
    }> = [];

    for (const serviceType of serviceTypes) {
      const plans = await this.fetchUpcomingPlans(account, serviceType);
      for (const plan of plans) {
        const items = await this.fetchServiceItems(account, serviceType.id, plan.id);
        for (const item of items) {
          result.push({
            itemId: `${plan.id}:${item.id}`,
            title: item.title,
            itemType: item.itemType,
            sequence: item.sequence,
            serviceTypeName: serviceType.name,
            planId: plan.id,
            planDate: plan.planDate,
            daysUntil: daysUntil(plan.planDate),
          });
        }
      }
    }

    return result;
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

        const publishedAt =
          asString(attrs.published_at) ??
          asString(attrs.publish_at) ??
          null;

        return {
          id: resource.id,
          serviceTypeId: serviceType.id,
          serviceTypeName: serviceType.name,
          title,
          planDate,
          publishedAt,
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
        teamName: null,
        positionName,
        signalType: 'needed_position_open',
        serviceTypeName: plan.serviceTypeName,
        planId: plan.id,
        planTitle: plan.title,
        planDate: plan.planDate,
        daysUntil: daysUntil(plan.planDate),
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
        title: entry.people.length === 1
          ? `Replace ${entry.people[0]} — ${entry.positionName} for ${plan.title}`
          : `Replace ${entry.people.length} people — ${entry.positionName} for ${plan.title}`,
        notes:
          `${peopleLabel} declined the ${entry.positionName} invitation` +
          ` in Planning Center for ${plan.serviceTypeName} on ${plan.planDate}.`,
        dueDate: plan.planDate,
        scheduledDate: mondayOfServiceWeek(plan.planDate),
        dedupeKey: key,
        teamId: entry.teamId,
        teamName: null,
        positionName: entry.positionName,
        signalType: 'team_member_declined',
        serviceTypeName: plan.serviceTypeName,
        planId: plan.id,
        planTitle: plan.title,
        planDate: plan.planDate,
        daysUntil: daysUntil(plan.planDate),
      };
    });
  }

  private async fetchUnconfirmedSignals(
    account: IntegrationAccount,
    plan: PlanSummary,
  ): Promise<Array<PlanningCenterTaskSignal & { positionName: string }>> {
    const payload = await this.getJson(
      account,
      `/services/v2/service_types/${plan.serviceTypeId}/plans/${plan.id}/team_members?per_page=100`,
    );

    const signals: Array<PlanningCenterTaskSignal & { positionName: string }> =
      [];
    for (const resource of payload.data ?? []) {
        const attrs = resource.attributes ?? {};
        const status = (asString(attrs.status) ?? '').toLowerCase();
        if (status != 'unconfirmed' && status != 'u') continue;

        const personName =
          asString(attrs.person_name) ??
          asString(attrs.name) ??
          asString(attrs.team_member_name) ??
          'Someone';
        const positionName =
          asString(attrs.team_position_name) ??
          asString(attrs.position_name) ??
          'position';

        signals.push({
          sourceId: `planning_center:unconfirmed:${plan.id}:${resource.id}`,
          title: `Confirm ${personName} — ${positionName} for ${plan.title}`,
          notes:
            `${personName} is still unconfirmed for the ${positionName}` +
            ` assignment in Planning Center for ${plan.serviceTypeName} on ${plan.planDate}.`,
          dueDate: plan.planDate,
          scheduledDate: mondayOfServiceWeek(plan.planDate),
          dedupeKey: `${roleKey(plan.id, positionName)}:unconfirmed:${resource.id}`,
          teamId: resource.relationships?.team?.data?.id ?? null,
          teamName: null,
          positionName,
          signalType: 'team_member_unconfirmed' as const,
          serviceTypeName: plan.serviceTypeName,
          planId: plan.id,
          planTitle: plan.title,
          planDate: plan.planDate,
          daysUntil: daysUntil(plan.planDate),
        });
    }

    return signals;
  }

  async listServiceTypes(account: IntegrationAccount) {
    const res = await this.getJson(account, '/services/v2/service_types?per_page=100');
    return (res.data ?? []).map((r) => ({
      id: r.id,
      name: (r.attributes?.name as string | undefined) ?? '',
    }));
  }

  /**
   * `filter` was hard-coded to `future`, which made past plans unreachable
   * through Rhythm entirely. The pco-song-usage-sync job exists to record
   * which songs were played on which past service dates, and the skill points
   * it at this endpoint — so the job could never be completed as specified.
   * Every run since 2026-07-26 reported the same blocker, in the agent's own
   * words: "the available PCO listing does not expose pagination, so it cannot
   * provide a verifiable complete historic export."
   *
   * Past listings are ordered newest-first on purpose: PCO defaults to
   * ascending sort_date, so `filter=past` alone returns the OLDEST plans in
   * the service type's history — for a service running weekly since 2016 that
   * is a decade of irrelevant rows and none of the recent ones.
   *
   * ponytail: one page of 100 (PCO's per_page max), no offset paging. Newest
   * 100 past plans is ~2 years of a weekly service and the applier is
   * idempotent, so a weekly sync can never fall behind it. Add offset paging
   * here if some job ever needs deeper history — not in the callers.
   */
  async listPlans(
    account: IntegrationAccount,
    serviceTypeId: string,
    filter: 'future' | 'past' = 'future',
  ) {
    const order = filter === 'past' ? '&order=-sort_date' : '';
    const res = await this.getJson(
      account,
      `/services/v2/service_types/${serviceTypeId}/plans?filter=${filter}&per_page=100${order}`,
    );
    return (res.data ?? []).map((r) => ({
      id: r.id,
      title: (r.attributes?.title as string | undefined) ?? null,
      dates: (r.attributes?.dates as string | undefined) ?? null,
    }));
  }

  async listPlanItems(
    account: IntegrationAccount,
    serviceTypeId: string,
    planId: string,
  ) {
    const res = await this.getJson(
      account,
      `/services/v2/service_types/${serviceTypeId}/plans/${planId}/items?per_page=100`,
    );
    return (res.data ?? []).map((r) => ({
      id: r.id,
      title: (r.attributes?.title as string | undefined) ?? null,
      type: (r.attributes?.item_type as string | undefined) ?? null,
    }));
  }

  async listNeededPositions(
    account: IntegrationAccount,
    serviceTypeId: string,
    planId: string,
  ) {
    const res = await this.getJson(
      account,
      `/services/v2/service_types/${serviceTypeId}/plans/${planId}/needed_positions?per_page=100`,
    );
    return (res.data ?? []).map((r) => ({
      id: r.id,
      teamPositionName: (r.attributes?.team_position_name as string | undefined) ?? null,
      quantity: (r.attributes?.quantity as number | undefined) ?? null,
    }));
  }

  async fetchServiceItems(
    account: IntegrationAccount,
    serviceTypeId: string,
    planId: string,
  ): Promise<Array<{ id: string; title: string; itemType: string; sequence: number }>> {
    const payload = await this.getJson(
      account,
      `/services/v2/service_types/${serviceTypeId}/plans/${planId}/items?per_page=100`,
    );
    return (payload.data ?? []).map((resource) => {
      const attrs = resource.attributes ?? {};
      return {
        id: resource.id,
        title: asString(attrs.title) ?? asString(attrs.name) ?? 'Service Item',
        itemType: asString(attrs.item_type) ?? asString(attrs.type) ?? 'song',
        sequence: (attrs.sequence as number) ?? 0,
      };
    });
  }

  private async sendJson(
    account: IntegrationAccount,
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<JsonApiResponse> {
    const response = await fetch(
      `https://api.planningcenteronline.com${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          'User-Agent': 'Rhythm (https://github.com/ajhochy/Rhythm)',
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    if (response.status === 403) {
      throw new PcoPermissionError();
    }
    if (!response.ok) {
      const text = await response.text();
      throw AppError.badRequest(`Planning Center request failed: ${text}`);
    }
    return (await response.json()) as JsonApiResponse;
  }

  async updatePlanItem(
    account: IntegrationAccount,
    serviceTypeId: string,
    planId: string,
    itemId: string,
    attributes: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const res = await this.sendJson(
      account,
      'PATCH',
      `/services/v2/service_types/${serviceTypeId}/plans/${planId}/items/${itemId}`,
      { data: { type: 'Item', id: itemId, attributes } },
    );
    const data = res.data as unknown as { id?: string } | undefined;
    return { id: data?.id ?? itemId };
  }

  async assignPersonToPlan(
    account: IntegrationAccount,
    planId: string,
    personId: string,
    teamId: string,
    positionName: string,
  ): Promise<{ id: string }> {
    const res = await this.sendJson(
      account,
      'POST',
      `/services/v2/plans/${planId}/team_members`,
      {
        data: {
          type: 'PlanPerson',
          attributes: { team_position_name: positionName },
          relationships: {
            person: { data: { type: 'Person', id: personId } },
            team: { data: { type: 'Team', id: teamId } },
          },
        },
      },
    );
    const data = res.data as unknown as { id?: string } | undefined;
    return { id: data?.id ?? '' };
  }

  async updateScheduledPerson(
    account: IntegrationAccount,
    planId: string,
    memberId: string,
    status: string,
  ): Promise<{ id: string }> {
    const res = await this.sendJson(
      account,
      'PATCH',
      `/services/v2/plans/${planId}/team_members/${memberId}`,
      { data: { type: 'PlanPerson', id: memberId, attributes: { status } } },
    );
    const data = res.data as unknown as { id?: string } | undefined;
    return { id: data?.id ?? memberId };
  }

  private async getJson(
    account: IntegrationAccount,
    path: string,
  ): Promise<JsonApiResponse> {
    const response = await fetch(`${pcoReadBaseUrl()}${path}`, {
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'User-Agent': 'Rhythm (https://github.com/ajhochy/Rhythm)',
        Accept: 'application/json',
      },
    });

    if (response.status === 403) throw new PcoPermissionError();
    if (!response.ok) {
      const text = await response.text();
      throw AppError.badRequest(`Planning Center sync failed: ${text}`);
    }

    return (await response.json()) as JsonApiResponse;
  }
}
