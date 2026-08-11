export const GOAL_METRIC_TYPES = ['number', 'percentage', 'currency'] as const;
export type GoalMetricType = (typeof GOAL_METRIC_TYPES)[number];

export const GOAL_HEALTH_VALUES = ['on_track', 'at_risk', 'off_track'] as const;
export type GoalHealth = (typeof GOAL_HEALTH_VALUES)[number];

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  metricType: GoalMetricType;
  startValue: number;
  currentValue: number;
  endValue: number;
  health: GoalHealth;
  startDate: string;
  endDate: string;
  ownerId: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGoalDto {
  title: string;
  description?: string | null;
  metricType: GoalMetricType;
  startValue: number;
  currentValue: number;
  endValue: number;
  health?: GoalHealth;
  startDate: string;
  endDate: string;
  ownerId: number;
}

export type UpdateGoalDto = Partial<Omit<CreateGoalDto, 'ownerId'>>;
