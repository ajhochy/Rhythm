/**
 * Verified research pin: Dayflow v2.6.0 / a45c7be14d1137fedaeb617db9c74fd2741256e2.
 * A detailed single-day export is `dayflow timeline DATE --json --detailed`.
 * The top object has schema_version=1, date, time_zone, day_boundary_hour=4,
 * cards and detail_available. Cards expose record_id/start/end/duration_minutes/
 * title/summary/category and optional documented detailed fields. The source has
 * no cursor, update stamp, or stable event identity across reprocessing; it
 * therefore cannot drive automatic deletion/correction. Full contract review
 * (including status/error behavior) is still pending, so process execution stays
 * disabled and fixture-v1 remains the only enabled source.
 */
export const DAYFLOW_EXPORT_CONTRACT_STATUS = 'adapter_not_ready' as const;
export const DAYFLOW_EXPORT_CONTRACT_REASON =
  'The pinned Dayflow schema has partial research evidence, but its complete operational contract is still under review.';
