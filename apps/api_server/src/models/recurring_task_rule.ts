export interface RecurringTaskRule {
  id: string;
  title: string;
  frequency: 'weekly' | 'monthly' | 'annual';
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  month: number | null;
  createdAt: string;
}

export interface CreateRecurringTaskRuleDto {
  title: string;
  frequency: 'weekly' | 'monthly' | 'annual';
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  month?: number | null;
}

export interface UpdateRecurringTaskRuleDto {
  title?: string;
  frequency?: 'weekly' | 'monthly' | 'annual';
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  month?: number | null;
}
