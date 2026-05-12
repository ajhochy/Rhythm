/** Status values accepted by the filter param ('all' means no status filter). */
export type FilterStatus = 'open' | 'in_progress' | 'waiting_for_reply' | 'done' | 'all';

/**
 * Typed filter object passed to TasksRepository.findByFilterAsync.
 * All user-supplied string values are validated before reaching the repository;
 * the repository binds them as SQL parameters — never interpolated into SQL.
 */
export interface TaskFilter {
  userId: number;
  /** 'all' means no status clause. Defaults to 'open'. */
  status: FilterStatus;
  /** Return tasks where COALESCE(scheduled_date, due_date) <= scheduledBefore */
  scheduledBefore?: string;
  /** Return tasks where due_date IS NOT NULL AND due_date <= dueBefore */
  dueBefore?: string;
  /**
   * When true: status != 'done' AND COALESCE(scheduled_date, due_date) < today.
   * When false: exclude those tasks.
   * Caller must provide `today` (YYYY-MM-DD) for the comparison.
   */
  overdue?: boolean;
  /** Case-insensitive substring match against title. */
  search?: string;
  /**
   * Today's date in YYYY-MM-DD format, injected by the controller.
   * Required when `overdue` is set; ignored otherwise.
   */
  today?: string;
}
