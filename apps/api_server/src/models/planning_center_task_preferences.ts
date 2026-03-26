export interface PlanningCenterTaskPreferences {
  teamIds: string[];
  positionNames: string[];
}

export const defaultPlanningCenterTaskPreferences: PlanningCenterTaskPreferences = {
  teamIds: [],
  positionNames: [],
};

export interface PlanningCenterTeamOption {
  id: string;
  name: string;
  serviceTypeId: string;
  serviceTypeName: string;
}

export interface PlanningCenterTaskOptions {
  teams: PlanningCenterTeamOption[];
  positionsByTeamId: Record<string, string[]>;
}
