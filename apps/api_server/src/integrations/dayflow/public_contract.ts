export type ReadinessState = 'unconfigured' | 'missing' | 'unsupported' | 'unverified' | 'changed' | 'ready';
export type DayflowErrorCode = 'INVALID_REQUEST' | 'CURSOR_INVALID' | 'SOURCE_MISSING' | 'SOURCE_UNSUPPORTED' | 'SOURCE_UNVERIFIED' | 'SOURCE_CHANGED' | 'DISABLED' | 'TIMEZONE_REQUIRED' | 'PREVIEW_EXPIRED' | 'PREVIEW_INVALIDATED' | 'SELECTION_CONFLICT' | 'PENDING_OPERATION' | 'CURSOR_STALE' | 'READER_TIMEOUT' | 'READER_CANCELLED' | 'READER_FAILED' | 'EXPORT_INVALID' | 'EXPORT_LIMIT' | 'TIMEZONE_MISMATCH' | 'IMPORT_UNCERTAIN' | 'LEDGER_UNAVAILABLE' | 'INTERNAL_ERROR' | 'OWNED_NOTE_NOT_FOUND' | 'LOCAL_ONLY' | 'FORBIDDEN_ORIGIN';
export interface SourceLabel { label: string; version: '2.6.0'; build: '133'; }
export interface SourceReadiness { state: ReadinessState; source: SourceLabel | null; code: DayflowErrorCode | null; }
export interface DayflowPublicStatus { enabled: boolean; automaticImport: false; readiness: SourceReadiness; canPreview: boolean; importedCount: number; pendingCreateCount: number; pendingDeleteCount: number; }
export type DayflowStatus = DayflowPublicStatus;
export interface SourceCheckResponse extends SourceReadiness { selectionToken?: string; expiresAt?: string; }
export interface PublicDayflowConfig { enabled: boolean; automaticImport: false; timezone: string | null; rolloverHour: 4; exclusions: string[]; maxRecordsPerRun: number; source: SourceLabel | null; }
export interface ConfigPatch { enabled?: boolean; timezone?: string; exclusions?: string[]; maxRecordsPerRun?: number; sourceSelectionToken?: string; }
export interface PreviewRequest { date: string; }
export interface PreviewResponse {
  token: string; expiresAt: string; date: string; timeZone: string; coverage: 'existing_cards'; analysisCompleteness: 'unknown';
  candidates: Array<{ candidateId: string; summary: string; observedStart: string; observedEnd?: string; category?: string; trust: 'unverified'; }>;
  withheld: Array<{ recordIndex: number; code: 'SENSITIVE_CONTENT' | 'EMPTY_CONTENT' | 'SUMMARY_LIMIT'; }>;
}
export interface CommitRequest { token: string; candidateIds: string[]; }
export interface CommitResponse { items: Array<{ candidateId: string; state: 'imported' | 'skipped' | 'conflict' | 'pending'; memoryId?: string; code?: DayflowErrorCode; }>; }
export interface OwnedNote { memoryId: string; importedAt: string; state: 'imported' | 'pending_create' | 'pending_delete'; }
export interface OwnedNotesPage { items: OwnedNote[]; nextCursor: string | null; total: number; }
export interface ForgetRequest { memoryId: string; }
export interface ForgetResponse { memoryId: string; state: 'forgotten'; }
export interface DayflowErrorEnvelope { error: { code: DayflowErrorCode; message: string; retryable: boolean; recovery: 'configure' | 'check_source' | 'retry' | 'refresh_preview' | 'reload_list' | 'none'; requestId: string; }; }

/**
 * The only backend boundary used by the management router.  Implementations
 * own all persistence, source qualification, preview, and ledger semantics;
 * the router only validates/serializes this public contract.
 */
export interface DayflowManagementService {
  status(): DayflowStatus | Promise<DayflowStatus>;
  readiness(): SourceReadiness | Promise<SourceReadiness>;
  checkReadiness(input: { bundlePath: string }): SourceCheckResponse | Promise<SourceCheckResponse>;
  getConfig(): PublicDayflowConfig | Promise<PublicDayflowConfig>;
  updateConfig(patch: ConfigPatch): PublicDayflowConfig | Promise<PublicDayflowConfig>;
  preview(request: PreviewRequest): PreviewResponse | Promise<PreviewResponse>;
  commit(request: CommitRequest): CommitResponse | Promise<CommitResponse>;
  listOwnedNotes(input: { limit: number; cursor?: string }): OwnedNotesPage | Promise<OwnedNotesPage>;
  forget(request: ForgetRequest): ForgetResponse | Promise<ForgetResponse>;
  disable(): DayflowStatus | Promise<DayflowStatus>;
  dispose?(): void | Promise<void>;
}

const DAYFLOW_ERROR_CODES: ReadonlySet<string> = new Set<DayflowErrorCode>([
  'INVALID_REQUEST', 'CURSOR_INVALID', 'SOURCE_MISSING', 'SOURCE_UNSUPPORTED', 'SOURCE_UNVERIFIED', 'SOURCE_CHANGED',
  'DISABLED', 'TIMEZONE_REQUIRED', 'PREVIEW_EXPIRED', 'PREVIEW_INVALIDATED', 'SELECTION_CONFLICT', 'PENDING_OPERATION',
  'CURSOR_STALE', 'READER_TIMEOUT', 'READER_CANCELLED', 'READER_FAILED', 'EXPORT_INVALID', 'EXPORT_LIMIT',
  'TIMEZONE_MISMATCH', 'IMPORT_UNCERTAIN', 'LEDGER_UNAVAILABLE', 'INTERNAL_ERROR', 'OWNED_NOTE_NOT_FOUND',
  'LOCAL_ONLY', 'FORBIDDEN_ORIGIN',
]);

export function isDayflowErrorCode(value: unknown): value is DayflowErrorCode {
  return typeof value === 'string' && DAYFLOW_ERROR_CODES.has(value);
}
export const DAYFLOW_ERROR_CATALOG: Record<DayflowErrorCode, { message: string; retryable: boolean; recovery: 'configure' | 'check_source' | 'retry' | 'refresh_preview' | 'reload_list' | 'none' }> = {
  INVALID_REQUEST:{message:'Invalid Dayflow request.',retryable:false,recovery:'none'},CURSOR_INVALID:{message:'Invalid list cursor.',retryable:false,recovery:'reload_list'},SOURCE_MISSING:{message:'Dayflow source is missing.',retryable:false,recovery:'configure'},SOURCE_UNSUPPORTED:{message:'Dayflow source is unsupported.',retryable:false,recovery:'check_source'},SOURCE_UNVERIFIED:{message:'Dayflow source is unverified.',retryable:false,recovery:'check_source'},SOURCE_CHANGED:{message:'Dayflow source changed.',retryable:false,recovery:'check_source'},DISABLED:{message:'Dayflow is disabled.',retryable:false,recovery:'configure'},TIMEZONE_REQUIRED:{message:'Dayflow timezone is required.',retryable:false,recovery:'configure'},PREVIEW_EXPIRED:{message:'Preview expired.',retryable:false,recovery:'refresh_preview'},PREVIEW_INVALIDATED:{message:'Preview was invalidated.',retryable:false,recovery:'refresh_preview'},SELECTION_CONFLICT:{message:'Preview selection changed.',retryable:false,recovery:'refresh_preview'},PENDING_OPERATION:{message:'Operation is pending.',retryable:false,recovery:'reload_list'},CURSOR_STALE:{message:'List changed; reload it.',retryable:false,recovery:'reload_list'},READER_TIMEOUT:{message:'Dayflow reader timed out.',retryable:true,recovery:'retry'},READER_CANCELLED:{message:'Dayflow reader was cancelled.',retryable:false,recovery:'none'},READER_FAILED:{message:'Dayflow reader failed.',retryable:true,recovery:'retry'},EXPORT_INVALID:{message:'Dayflow export is invalid.',retryable:true,recovery:'retry'},EXPORT_LIMIT:{message:'Dayflow export exceeds limits.',retryable:false,recovery:'none'},TIMEZONE_MISMATCH:{message:'Dayflow export timezone mismatched.',retryable:true,recovery:'check_source'},IMPORT_UNCERTAIN:{message:'Import outcome is uncertain.',retryable:false,recovery:'reload_list'},LEDGER_UNAVAILABLE:{message:'Dayflow ledger is unavailable.',retryable:true,recovery:'retry'},INTERNAL_ERROR:{message:'Dayflow is unavailable.',retryable:true,recovery:'retry'},OWNED_NOTE_NOT_FOUND:{message:'Owned note was not found.',retryable:false,recovery:'reload_list'},LOCAL_ONLY:{message:'Dayflow is local only.',retryable:false,recovery:'none'},FORBIDDEN_ORIGIN:{message:'Dayflow request is forbidden.',retryable:false,recovery:'none'} };
