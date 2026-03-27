export interface RecurringTaskRule {
  id: string;
  title: string;
  frequency: 'weekly' | 'monthly' | 'annual';
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  month: number | null;
  enabled: boolean;
  createdAt: string;
}

export interface CreateRecurringTaskRuleDto {
  title: string;
  frequency: 'weekly' | 'monthly' | 'annual';
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  month?: number | null;
  enabled?: boolean;
}

export interface UpdateRecurringTaskRuleDto {
  title?: string;
  frequency?: 'weekly' | 'monthly' | 'annual';
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  month?: number | null;
  enabled?: boolean;
}
