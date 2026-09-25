import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { FocusDialog } from '../../components/FocusDialog';
import { Timestamp } from '../../components/Timestamp';
import { formatTimestamp, wallClockInstant } from '../../timestamps';
import { ListInspector, useSelectedId, type ListInspectorItem } from '../../components/ListInspector';
import { navigate } from '../../components/Shell';
import { Icon } from '../../icons';
import { useFixtures } from '../../store';
import { useGateway } from '../../gateway/context';
import { LiveFacilitiesPage } from './live';
import {
  cloneSeededFacilities,
  cloneSeededReservations,
  currentFacilityUser,
  initialFacilityReceipts,
  type Facility,
  type Reservation,
} from './fixtures';
import './styles.css';

type SurfaceState = 'ready' | 'loading' | 'empty' | 'server-error' | 'forbidden' | 'unavailable' | 'readonly';
type RangeMode = 'day' | 'week' | 'month';
type EditorMode = 'create' | 'reservation' | 'group' | 'series';

type RecurrenceType = 'weekly' | 'biweekly' | 'monthly' | 'custom';

const surfaceStates: SurfaceState[] = ['ready', 'loading', 'empty', 'server-error', 'forbidden', 'unavailable', 'readonly'];

function hashParams() {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}

function initialSurfaceState(): SurfaceState {
  const requested = hashParams().get('state');
  return surfaceStates.includes(requested as SurfaceState) ? requested as SurfaceState : 'ready';
}

function slug(value: string) {
  return value.toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unassigned';
}

function dateOnly(value: string) {
  return value.slice(0, 10);
}

function timeOnly(value: string) {
  return value.slice(11, 16);
}

function displayTime(value: string) {
  return formatTimestamp(wallClockInstant(value)?.toISOString())?.label ?? 'Time unavailable';
}

function displayDate(value: string) {
  // Date-only reservation value: UTC prevents viewer offsets from shifting the calendar day.
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${dateOnly(value)}T12:00:00Z`));
}

function utcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day));
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, count: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + count);
  return next;
}

function rangeFor(mode: RangeMode, offset: number) {
  const anchor = utcDate(2026, 7, 12);
  if (mode === 'day') {
    const day = addDays(anchor, offset);
    const value = isoDay(day);
    // Date-only range label: UTC preserves the selected facility calendar day.
    return { start: `${value}T00:00:00.000`, end: `${value}T23:59:59.999`, label: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(day) };
  }
  if (mode === 'week') {
    const monday = addDays(anchor, -2 + (offset * 7));
    const sunday = addDays(monday, 6);
    // Date-only range labels: UTC preserves the selected facility calendar days.
    const startLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(monday);
    const endLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(sunday);
    return { start: `${isoDay(monday)}T00:00:00.000`, end: `${isoDay(sunday)}T23:59:59.999`, label: `${startLabel} - ${endLabel}` };
  }
  const month = utcDate(2026, 7 + offset, 1);
  const end = utcDate(month.getUTCFullYear(), month.getUTCMonth() + 1, 0);
  return {
    start: `${isoDay(month)}T00:00:00.000`,
    end: `${isoDay(end)}T23:59:59.999`,
    // Date-only range label: UTC preserves the selected facility calendar month.
    label: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(month),
  };
}

function overlaps(reservation: Reservation, date: string, start: string, end: string, excludedIds: string[] = []) {
  if (excludedIds.includes(reservation.id) || dateOnly(reservation.start) !== date) return false;
  return timeOnly(reservation.start) < end && timeOnly(reservation.end) > start;
}

function ActionMenu({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [open]);

  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    if (!items.length) return;
    event.preventDefault();
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return <div className="facilities-menu-anchor" ref={rootRef} onClick={(event) => event.stopPropagation()}>
    <button ref={triggerRef} className="icon-button" type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} data-testid={testId}><span aria-hidden="true">•••</span></button>
    {open && <div className="menu-popover facilities-menu" role="menu" aria-label={label} onKeyDown={moveFocus} onClick={(event) => { if ((event.target as HTMLElement).closest('[role="menuitem"]')) setOpen(false); }}>{children}</div>}
  </div>;
}

function StatePanel({ state, onRetry, onAdd }: { state: Exclude<SurfaceState, 'ready' | 'readonly'>; onRetry(): void; onAdd(): void }) {
  if (state === 'loading') return <section className="facilities-state" role="status" aria-live="polite" data-testid="page-state-loading"><span className="facilities-state-symbol" aria-hidden="true">◌</span><h2>Loading facilities</h2><p>Gathering rooms, reservation series, and the cross-facility schedule.</p></section>;
  if (state === 'empty') return <section className="facilities-state" role="status" data-testid="page-state-empty"><span className="facilities-state-symbol" aria-hidden="true">+</span><h2>No facilities yet</h2><p>Add the first space to make room reservations available to this workspace.</p><button className="primary-button" type="button" onClick={onAdd} data-testid="facilities-empty-add-space">Add Space</button></section>;
  if (state === 'server-error') return <section className="facilities-state danger" role="alert" data-testid="page-state-server-error"><strong className="facilities-state-code">503</strong><h2>Facilities could not be loaded</h2><p>The schedule service returned a temporary error. Retry to load the current schedule.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
  if (state === 'forbidden') return <section className="facilities-state warning" role="alert" data-testid="page-state-forbidden"><strong className="facilities-state-code">403</strong><h2>Workspace access required</h2><p>Join an authenticated Rhythm workspace before inspecting its facilities.</p></section>;
  return <section className="facilities-state warning" role="status" data-testid="page-state-unavailable"><span className="facilities-state-symbol" aria-hidden="true">◇</span><h2>Facilities are unavailable</h2><p>Reconnect the local Rhythm API before loading rooms or reservations.</p></section>;
}

function ConfirmDialog({ item, kind, onClose, onConfirm }: { item: Facility | Reservation | null; kind: 'room' | 'reservation' | 'series'; onClose(): void; onConfirm(): void }) {
  const open = Boolean(item);
  const title = kind === 'room' ? 'Delete space?' : kind === 'series' ? 'Delete entire series?' : 'Delete reservation?';
  const testId = kind === 'room' ? 'facility-delete-dialog' : kind === 'series' ? 'facility-series-delete-dialog' : 'facility-reservation-delete-dialog';
  const name = item ? ('name' in item ? item.name : item.title) : '';
  const description = kind === 'series'
    ? `Delete ${name} and all generated reservations? This cannot be undone.`
    : kind === 'room'
      ? `Delete ${name} from the app? This cannot be undone.`
      : `Permanently remove this reservation, ${name}? This cannot be undone.`;
  return <FocusDialog open={open} title={title} description={description} onClose={onClose} testId={testId}>
    <div className="facilities-confirm-copy"><strong>{name}</strong><p>{description}</p></div>
    <div className="dialog-actions">
      <button className="secondary-button" type="button" onClick={onClose} data-testid={kind === 'reservation' ? 'facility-reservation-delete-cancel' : `${testId}-cancel`}>Cancel</button>
      <button className="danger-button" type="button" onClick={onConfirm} data-testid={kind === 'room' ? 'facility-delete-confirm' : kind === 'series' ? 'facility-series-delete-confirm' : 'facility-reservation-delete-confirm'}>Delete {kind === 'room' ? 'space' : kind === 'series' ? 'entire series' : 'reservation'}</button>
    </div>
  </FocusDialog>;
}

export function FacilitiesPage({ route }: { route: string }) {
  const gateway = useGateway();
  if (gateway.mode === 'live') return <LiveFacilitiesPage route={route} />;
  return <FixtureFacilitiesPage route={route} />;
}

function FixtureFacilitiesPage({ route }: { route: string }) {
  const { notify } = useFixtures();
  const [surfaceState, setSurfaceState] = useState<SurfaceState>(initialSurfaceState);
  const [facilities, setFacilities] = useState<Facility[]>(cloneSeededFacilities);
  const [reservations, setReservations] = useState<Reservation[]>(cloneSeededReservations);
  const [receipts, setReceipts] = useState<string[]>(() => [...initialFacilityReceipts]);
  const [selectedItemId, setSelectedItemId] = useSelectedId('facilityItemId');
  const [mode, setMode] = useState<'overview' | 'rooms'>(() => route.startsWith('/facilities/rooms') || hashParams().get('facilityItemId')?.startsWith('room-') ? 'rooms' : 'overview');
  const [rangeMode, setRangeMode] = useState<RangeMode>('week');
  const [rangeOffset, setRangeOffset] = useState(0);
  const [buildingFilter, setBuildingFilter] = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const [reservationDialogOpen, setReservationDialogOpen] = useState(false);
  const [reservationMode, setReservationMode] = useState<EditorMode>('create');
  const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>(['101']);
  const [reservationTitle, setReservationTitle] = useState('');
  const [requesterName, setRequesterName] = useState<string>(currentFacilityUser.name);
  const [reservationDate, setReservationDate] = useState('2026-08-12');
  const [reservationStart, setReservationStart] = useState('');
  const [reservationEnd, setReservationEnd] = useState('');
  const [reservationNotes, setReservationNotes] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('weekly');
  const [seriesEnd, setSeriesEnd] = useState('');
  const [customDates, setCustomDates] = useState<string[]>([]);
  const [customDateOpen, setCustomDateOpen] = useState(false);
  const [customDateInput, setCustomDateInput] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [groupSummary, setGroupSummary] = useState<string | null>(null);
  const [recurringSummary, setRecurringSummary] = useState<string | null>(null);
  const [facilityEditorOpen, setFacilityEditorOpen] = useState(false);
  const [editingFacility, setEditingFacility] = useState<Facility | null>(null);
  const [facilityName, setFacilityName] = useState('');
  const [facilityBuilding, setFacilityBuilding] = useState('');
  const [newBuilding, setNewBuilding] = useState('');
  const [facilityDescription, setFacilityDescription] = useState('');
  const [facilityNameError, setFacilityNameError] = useState('');
  const [deleteFacilityTarget, setDeleteFacilityTarget] = useState<Facility | null>(null);
  const [deleteReservationTarget, setDeleteReservationTarget] = useState<Reservation | null>(null);
  const [deleteSeriesTarget, setDeleteSeriesTarget] = useState<Reservation | null>(null);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [automationRoom, setAutomationRoom] = useState('');
  const [automationStart, setAutomationStart] = useState('');
  const [automationEnd, setAutomationEnd] = useState('');

  const readonly = surfaceState === 'readonly';
  const readyLike = surfaceState === 'ready' || readonly;
  const manager = currentFacilityUser.isFacilitiesManager;
  const currentRange = rangeFor(rangeMode, rangeOffset);
  const requestedRoomId = route.startsWith('/facilities/rooms/') ? decodeURIComponent(route.slice('/facilities/rooms/'.length)) : null;
  const requestedReservationId = route.startsWith('/facilities/reservations/') ? decodeURIComponent(route.slice('/facilities/reservations/'.length)) : null;
  const requestedItemId = requestedRoomId ? `room-${requestedRoomId}` : requestedReservationId ? `reservation-${requestedReservationId}` : null;

  const appendReceipt = (receipt: string) => setReceipts((current) => [...current, receipt]);
  const updateStateUrl = (next: SurfaceState) => {
    const params = hashParams();
    params.set('state', next);
    history.replaceState(null, '', `#${route}?${params.toString()}`);
  };
  const chooseSurfaceState = (next: SurfaceState) => { setSurfaceState(next); updateStateUrl(next); };
  const overviewReceipt = (nextMode = rangeMode, nextOffset = rangeOffset, nextBuilding = buildingFilter, nextRoom = roomFilter) => {
    const range = rangeFor(nextMode, nextOffset);
    const extras = `${nextBuilding ? `&building=${nextBuilding}` : ''}${nextRoom ? `&facilityId=${nextRoom}` : ''}`;
    appendReceipt(`GET /facilities/reservations?start=${range.start}&end=${range.end}${extras} → 200`);
  };
  const refreshReceipts = () => {
    appendReceipt('GET /facilities → 200');
    facilities.forEach((facility) => {
      appendReceipt(`GET /facilities/${facility.id}/reservations → 200`);
      appendReceipt(`GET /facilities/${facility.id}/reservation-series → 200`);
    });
    overviewReceipt();
  };

  const filteredReservations = useMemo(() => reservations.filter((reservation) => {
    if (reservation.automation) return false;
    const facility = facilities.find((item) => item.id === reservation.facilityId);
    if (!facility) return false;
    if (buildingFilter && facility.building !== buildingFilter) return false;
    if (roomFilter && reservation.facilityId !== roomFilter) return false;
    return reservation.start.slice(0, 23) >= currentRange.start && reservation.start.slice(0, 23) <= currentRange.end;
  }), [buildingFilter, currentRange.end, currentRange.start, facilities, reservations, roomFilter]);

  const groupedFacilities = useMemo(() => {
    const buildings = [...new Set(facilities.map((facility) => facility.building).filter((value): value is string => Boolean(value)))].sort();
    return [...buildings, null].map((building) => ({
      building,
      facilities: facilities.filter((facility) => facility.building === building).sort((left, right) => left.name.localeCompare(right.name)),
    })).filter((group) => group.facilities.length > 0);
  }, [facilities]);

  const defaultItemId = mode === 'rooms'
    ? facilities[0] ? `room-${facilities[0].id}` : null
    : filteredReservations[0] ? `reservation-${filteredReservations[0].id}` : null;
  const effectiveSelectedItemId = selectedItemId ?? requestedItemId ?? defaultItemId;
  const selectedRoomId = effectiveSelectedItemId?.startsWith('room-') ? effectiveSelectedItemId.slice('room-'.length) : null;
  const selectedReservationId = effectiveSelectedItemId?.startsWith('reservation-') ? effectiveSelectedItemId.slice('reservation-'.length) : null;
  const selectedRoom = facilities.find((facility) => facility.id === selectedRoomId) ?? null;
  const selectedReservation = reservations.find((reservation) => reservation.id === selectedReservationId) ?? null;
  const invalidRoom = Boolean(requestedRoomId && !selectedRoom);
  const invalidReservation = Boolean(requestedReservationId && !selectedReservation);
  const visibleReservationIds = new Set(filteredReservations.map((reservation) => reservation.id));
  const roomItems: ListInspectorItem[] = groupedFacilities.flatMap((group) => group.facilities.map((facility) => {
    const upcoming = reservations.filter((reservation) => reservation.facilityId === facility.id && !reservation.automation).length;
    return {
      id: `room-${facility.id}`,
      title: facility.name,
      subtitle: facility.description,
      meta: upcoming ? `${upcoming} upcoming` : 'Available',
      group: `building-${slug(group.building ?? 'unassigned')}`,
    };
  }));
  const reservationItems: ListInspectorItem[] = reservations.filter((reservation) => !reservation.automation).map((reservation) => {
    const facility = facilities.find((item) => item.id === reservation.facilityId);
    return {
      id: `reservation-${reservation.id}`,
      title: reservation.title,
      subtitle: `${displayTime(reservation.start)}-${displayTime(reservation.end)} · ${facility?.name ?? 'Unknown room'}`,
      meta: reservation.requesterName,
      badge: reservation.conflicted ? 'Conflict' : reservation.seriesId ? 'Series' : reservation.groupId ? 'Linked' : reservation.notes ? 'Setup' : undefined,
      group: `date-${dateOnly(reservation.start)}`,
    };
  });
  const reservationGroups = [...new Set(reservations.filter((reservation) => !reservation.automation).map((reservation) => dateOnly(reservation.start)))].sort().map((date) => ({ id: `date-${date}`, label: displayDate(`${date}T00:00:00`) }));

  useEffect(() => {
    if (selectedItemId === null && effectiveSelectedItemId !== null) setSelectedItemId(effectiveSelectedItemId);
  }, [effectiveSelectedItemId, selectedItemId, setSelectedItemId]);

  useEffect(() => {
    if (selectedItemId?.startsWith('room-')) setMode('rooms');
    if (selectedItemId?.startsWith('reservation-')) setMode('overview');
  }, [selectedItemId]);

  const openReservationEditor = (facilityId = '101', reservation?: Reservation, editorMode: EditorMode = 'create', showDialog = true) => {
    setReservationMode(editorMode);
    setEditingReservation(reservation ?? null);
    if (reservation) {
      const related = reservation.groupId ? reservations.filter((item) => item.groupId === reservation.groupId) : [reservation];
      setSelectedRoomIds([...new Set(related.map((item) => item.facilityId))]);
      setReservationTitle(reservation.title);
      setRequesterName(reservation.requesterName);
      setReservationDate(dateOnly(reservation.start));
      setReservationStart(timeOnly(reservation.start));
      setReservationEnd(timeOnly(reservation.end));
      setReservationNotes(reservation.notes ?? '');
      setRecurring(Boolean(reservation.seriesId));
      setRecurrenceType('weekly');
      setSeriesEnd(reservation.seriesId ? '2026-09-30' : '');
      setCustomDates([]);
    } else {
      setSelectedRoomIds([facilityId]);
      setReservationTitle('');
      setRequesterName(currentFacilityUser.name);
      setReservationDate('2026-08-12');
      setReservationStart('');
      setReservationEnd('');
      setReservationNotes('');
      setRecurring(false);
      setRecurrenceType('weekly');
      setSeriesEnd('');
      setCustomDates([]);
    }
    setCustomDateOpen(false);
    setCustomDateInput('');
    setFormErrors({});
    setReservationDialogOpen(showDialog);
  };

  useEffect(() => {
    if (!selectedReservation) return;
    openReservationEditor(selectedReservation.facilityId, selectedReservation, selectedReservation.seriesId ? 'series' : selectedReservation.groupId ? 'group' : 'reservation', false);
  }, [selectedReservation?.id]);

  const closeReservationEditor = () => {
    setReservationDialogOpen(false);
    setEditingReservation(null);
    setFormErrors({});
  };

  const finishReservationSubmit = () => {
    if (reservationDialogOpen) {
      closeReservationEditor();
      return;
    }
    // A selected reservation remains the active inspector context after an
    // inline save. Clearing editingReservation here would make the next save
    // look like a create even though the same reservation is still selected.
    setFormErrors({});
  };

  const selectedConflicts = selectedRoomIds.flatMap((facilityId) => reservations.filter((reservation) => reservation.facilityId === facilityId && overlaps(
    reservation,
    reservationDate,
    reservationStart,
    reservationEnd,
    editingReservation?.groupId ? reservations.filter((item) => item.groupId === editingReservation.groupId).map((item) => item.id) : editingReservation ? [editingReservation.id] : [],
  )));

  const submitReservation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!selectedRoomIds.length) errors.room = 'Select at least one room';
    if (!reservationTitle.trim()) errors.title = 'Title is required';
    if (!requesterName.trim()) errors.requester = 'Requester is required';
    if (!reservationDate || !reservationStart || !reservationEnd) errors.slot = 'Choose a date, start time, and end time';
    else if (reservationEnd <= reservationStart) errors.slot = 'End time must be after the start time';
    if (recurring && recurrenceType !== 'custom' && !seriesEnd) errors.slot = 'Choose a series end date';
    if (reservationMode === 'create' && !recurring && selectedRoomIds.length === 1 && selectedConflicts.length) errors.slot = `${reservationTitle || 'This reservation'} overlaps an existing reservation`;
    setFormErrors(errors);
    if (Object.keys(errors).length) return;

    const firstRoomId = editingReservation?.facilityId ?? selectedRoomIds[0];
    const commonKeys = `title,requester_name,requester_user_id${selectedRoomIds.length > 1 || reservationMode === 'group' ? ',facility_ids' : ''}`;
    if (recurring || reservationMode === 'series') {
      const isEdit = reservationMode === 'series' && editingReservation?.seriesId;
      const recurrenceKeys = recurrenceType === 'custom' ? 'recurrence_type,custom_dates' : 'recurrence_type,recurrence_interval';
      const trailing = `start_time,end_time,start_date,end_date${isEdit ? ',notes' : ''}`;
      const routeValue = isEdit
        ? `/facilities/${firstRoomId}/reservation-series/${editingReservation.seriesId}`
        : `/facilities/${firstRoomId}/reservation-series`;
      appendReceipt(`${isEdit ? 'PATCH' : 'POST'} ${routeValue} {${commonKeys},${recurrenceKeys},${trailing}} → ${isEdit ? '200' : '201'}`);
      if (isEdit) {
        setReservations((current) => current.map((item) => item.seriesId === editingReservation.seriesId ? { ...item, title: reservationTitle.trim(), notes: reservationNotes || null } : item));
        setRecurringSummary('2 occurrences updated across the whole recurring series. Conflicted dates: none.');
      } else {
        const dates = recurrenceType === 'custom' ? [...new Set([reservationDate, ...customDates])] : [reservationDate, '2026-08-26'];
        const created = dates.map((date, index): Reservation => ({
          id: `series-created-${index + 1}`, facilityId: firstRoomId, title: reservationTitle.trim(), requesterName: requesterName.trim(), creatorId: currentFacilityUser.id,
          start: `${date}T${reservationStart}:00-07:00`, end: `${date}T${reservationEnd}:00-07:00`, notes: reservationNotes || null, seriesId: 'series-created-choir',
        }));
        setReservations((current) => [...current, ...created]);
        setRecurringSummary(`${created.length} occurrences created. Conflicted dates: Aug 26 · Sanctuary setup window.`);
      }
      finishReservationSubmit();
      return;
    }

    const isEdit = Boolean(editingReservation);
    const method = isEdit ? 'PATCH' : 'POST';
    const endpoint = editingReservation ? `/facilities/${firstRoomId}/reservations/${editingReservation.id}` : `/facilities/${firstRoomId}/reservations`;
    const notesKey = reservationNotes || isEdit ? ',notes' : '';
    appendReceipt(`${method} ${endpoint} {${commonKeys},start_time,end_time${notesKey}} → ${isEdit ? '200' : '201'}`);

    if (isEdit && editingReservation) {
      const oldRoomIds = editingReservation.groupId ? reservations.filter((item) => item.groupId === editingReservation.groupId).map((item) => item.facilityId) : [editingReservation.facilityId];
      setReservations((current) => current
        .filter((item) => !editingReservation.groupId || item.groupId !== editingReservation.groupId || selectedRoomIds.includes(item.facilityId))
        .map((item) => item.id === editingReservation.id || (editingReservation.groupId && item.groupId === editingReservation.groupId)
          ? { ...item, title: reservationTitle.trim(), requesterName: requesterName.trim(), start: `${reservationDate}T${reservationStart}:00-07:00`, end: `${reservationDate}T${reservationEnd}:00-07:00`, notes: reservationNotes || null }
          : item));
      if (reservationMode === 'group') {
        const removed = oldRoomIds.filter((id) => !selectedRoomIds.includes(id)).map((id) => facilities.find((facility) => facility.id === id)?.name).filter(Boolean);
        setGroupSummary(`Updated in: ${selectedRoomIds.map((id) => facilities.find((facility) => facility.id === id)?.name).filter(Boolean).join(', ')}. Removed from: ${removed.join(', ') || 'None'}. Conflicts: none.`);
      } else {
        notify('Reservation updated');
      }
    } else if (selectedRoomIds.length > 1) {
      const conflictRoomIds = new Set(selectedConflicts.map((item) => item.facilityId));
      const createdRoomIds = selectedRoomIds.filter((id) => !conflictRoomIds.has(id));
      setReservations((current) => [...current, ...createdRoomIds.map((facilityId, index): Reservation => ({
        id: `group-created-${index + 1}`, facilityId, title: reservationTitle.trim(), requesterName: requesterName.trim(), creatorId: currentFacilityUser.id,
        start: `${reservationDate}T${reservationStart}:00-07:00`, end: `${reservationDate}T${reservationEnd}:00-07:00`, notes: reservationNotes || null, groupId: 'group-created-briefing',
      }))]);
      setGroupSummary(`Created in: ${createdRoomIds.map((id) => facilities.find((facility) => facility.id === id)?.name).join(', ')}. Conflicts: ${[...conflictRoomIds].map((id) => facilities.find((facility) => facility.id === id)?.name).join(', ')} overlaps an existing reservation.`);
    } else {
      const reservation: Reservation = {
        id: '507', facilityId: firstRoomId, title: reservationTitle.trim(), requesterName: requesterName.trim(), creatorId: currentFacilityUser.id,
        start: `${reservationDate}T${reservationStart}:00-07:00`, end: `${reservationDate}T${reservationEnd}:00-07:00`, notes: reservationNotes || null,
      };
      setReservations((current) => [...current, reservation]);
      notify('Reservation created');
    }
    finishReservationSubmit();
  };

  const openFacilityEditor = (facility?: Facility) => {
    setEditingFacility(facility ?? null);
    setFacilityName(facility?.name ?? '');
    setFacilityBuilding(facility?.building ?? '');
    setNewBuilding('');
    setFacilityDescription(facility?.description ?? '');
    setFacilityNameError('');
    setFacilityEditorOpen(true);
  };

  useEffect(() => {
    if (mode !== 'rooms' || !selectedRoom) return;
    setEditingFacility(selectedRoom); setFacilityName(selectedRoom.name); setFacilityBuilding(selectedRoom.building ?? ''); setNewBuilding(''); setFacilityDescription(selectedRoom.description); setFacilityNameError('');
  }, [mode, selectedRoom?.id]);

  const submitFacility = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!facilityName.trim()) { setFacilityNameError('Room name is required'); return; }
    const building = facilityBuilding === '__new_building__' ? newBuilding.trim() : facilityBuilding;
    if (editingFacility) {
      setFacilities((current) => current.map((facility) => facility.id === editingFacility.id ? { ...facility, name: facilityName.trim(), building: building || null, description: facilityDescription.trim() } : facility));
      appendReceipt(`PATCH /facilities/${editingFacility.id} {name,description,building} → 200`);
      notify('Space updated');
    } else {
      setFacilities((current) => [...current, { id: '105', name: facilityName.trim(), building: building || null, description: facilityDescription.trim() }]);
      appendReceipt('POST /facilities {name,description,building} → 201');
      notify('Space created');
    }
    setFacilityEditorOpen(false);
  };

  const deleteFacility = () => {
    if (!deleteFacilityTarget) return;
    appendReceipt(`DELETE /facilities/${deleteFacilityTarget.id} → 204`);
    setFacilities((current) => current.filter((facility) => facility.id !== deleteFacilityTarget.id));
    setReservations((current) => current.filter((reservation) => reservation.facilityId !== deleteFacilityTarget.id));
    notify('Space deleted');
    setDeleteFacilityTarget(null);
  };

  const deleteReservation = () => {
    if (!deleteReservationTarget) return;
    appendReceipt(`DELETE /facilities/${deleteReservationTarget.facilityId}/reservations/${deleteReservationTarget.id} → 204`);
    setReservations((current) => deleteReservationTarget.groupId ? current.filter((item) => item.groupId !== deleteReservationTarget.groupId) : current.filter((item) => item.id !== deleteReservationTarget.id));
    notify('Reservation deleted');
    setDeleteReservationTarget(null);
  };

  const deleteSeries = () => {
    if (!deleteSeriesTarget?.seriesId) return;
    appendReceipt(`DELETE /facilities/${deleteSeriesTarget.facilityId}/reservation-series/${deleteSeriesTarget.seriesId} → 204`);
    setReservations((current) => current.filter((item) => item.seriesId !== deleteSeriesTarget.seriesId));
    notify('Recurring series deleted');
    setDeleteSeriesTarget(null);
  };

  const previewReceipt = (room = automationRoom, start = automationStart, end = automationEnd) => {
    const query = `${room ? `facilityId=${room}` : ''}${start ? `${room ? '&' : ''}startAfter=${start}T07:00:00.000Z` : ''}${end ? `${room || start ? '&' : ''}endBefore=${end}T07:00:00.000Z` : ''}`;
    appendReceipt(`GET /facilities/automation-reservations/preview${query ? `?${query}` : ''} → 200`);
  };

  const filteredAutomation = reservations.filter((reservation) => {
    if (!reservation.automation) return false;
    if (automationRoom && reservation.facilityId !== automationRoom) return false;
    const date = dateOnly(reservation.start);
    if (automationStart && date < automationStart) return false;
    if (automationEnd && date > automationEnd) return false;
    return true;
  });

  const openAutomation = () => {
    setAutomationRoom(''); setAutomationStart(''); setAutomationEnd(''); setAutomationOpen(true); previewReceipt('', '', '');
  };

  const cleanupAutomation = () => {
    const query = `${automationRoom ? `facilityId=${automationRoom}` : ''}${automationStart ? `${automationRoom ? '&' : ''}startAfter=${automationStart}T07:00:00.000Z` : ''}${automationEnd ? `${automationRoom || automationStart ? '&' : ''}endBefore=${automationEnd}T07:00:00.000Z` : ''}`;
    const deleted = filteredAutomation.length;
    appendReceipt(`DELETE /facilities/automation-reservations${query ? `?${query}` : ''} → 200`);
    setReservations((current) => current.filter((reservation) => !filteredAutomation.some((item) => item.id === reservation.id)));
    appendReceipt('GET /facilities → 200');
    setAutomationOpen(false);
    notify(`Deleted ${deleted} automation reservations`);
  };

  const reservationActions = (reservation: Reservation) => reservation.seriesId
    ? <ActionMenu label={`Actions for ${reservation.title}`} testId={`facility-reservation-actions-${reservation.id}`}>
        <button className="menu-item" role="menuitem" type="button" onClick={() => openReservationEditor(reservation.facilityId, reservation, 'series')} data-testid={`facility-series-menu-edit-${reservation.id}`}>Edit series</button>
        <button className="menu-item danger-item" role="menuitem" type="button" onClick={() => setDeleteSeriesTarget(reservation)} data-testid={`facility-series-menu-delete-${reservation.id}`}>Delete series</button>
      </ActionMenu>
    : <ActionMenu label={`Actions for ${reservation.title}`} testId={`facility-reservation-actions-${reservation.id}`}>
        <button className="menu-item" role="menuitem" type="button" onClick={() => openReservationEditor(reservation.facilityId, reservation, reservation.groupId ? 'group' : 'reservation')} data-testid={`facility-reservation-menu-edit-${reservation.id}`}>{reservation.groupId ? 'Edit reservation group' : 'Edit reservation'}</button>
        <button className="menu-item danger-item" role="menuitem" type="button" onClick={() => setDeleteReservationTarget(reservation)} data-testid={`facility-reservation-menu-delete-${reservation.id}`}>{reservation.groupId ? 'Delete reservation group' : 'Delete reservation'}</button>
      </ActionMenu>;

  return (
    <section className="page-shell pg-facilities" data-testid="page-facilities" aria-labelledby="facilities-title" {...(selectedReservationId ? { 'data-selected-stable-id': selectedReservationId } : {})}>
      <header className="facilities-header">
        <div className="facilities-heading">
          <h1 id="facilities-title">Facilities</h1>
          <p>Coordinate rooms, recurring schedules, and setup-sensitive reservations.</p>
        </div>
        <div className="facilities-header-tools">
          <span className="facilities-role" title="Current workspace identity"><strong>AJ</strong><span>Facilities manager</span></span>
          <label className="facilities-state-picker">View state<select value={surfaceState} onChange={(event) => chooseSurfaceState(event.target.value as SurfaceState)} data-testid="facilities-state-picker">{surfaceStates.map((state) => <option key={state} value={state}>{state}</option>)}</select></label>
        </div>
      </header>

      {readonly && <div className="facilities-readonly" id="facilities-readonly-reason" role="status" data-testid="page-state-readonly"><strong>Read-only Facilities</strong><span>Facilities manager or reservation creator access is required to change rooms and reservations. Inspection remains available.</span></div>}
      <nav className="facilities-mode-switch" aria-label="Facilities views">
        <button type="button" aria-pressed={mode === 'overview'} onClick={() => { setMode('overview'); setSelectedItemId(filteredReservations[0] ? `reservation-${filteredReservations[0].id}` : null); }} data-testid="facilities-mode-overview">Overview</button>
        <button type="button" aria-pressed={mode === 'rooms'} onClick={() => { setMode('rooms'); setSelectedItemId(facilities[0] ? `room-${facilities[0].id}` : null); }} data-testid="facilities-mode-rooms">Rooms</button>
      </nav>

      {mode === 'overview' && <section className="facilities-command-deck facilities-context-bar" aria-label="Schedule range and filters">
        <div className="facilities-range-controls">
          <div className="facilities-segmented" aria-label="Schedule range">
            {(['day', 'week', 'month'] as RangeMode[]).map((range) => <button key={range} type="button" aria-pressed={rangeMode === range} onClick={() => { setRangeMode(range); setRangeOffset(0); overviewReceipt(range, 0); }} data-testid={`facilities-range-${range}`}>{range[0].toUpperCase() + range.slice(1)}</button>)}
          </div>
          <div className="facilities-period-nav">
            <button className="icon-button" type="button" aria-label="Previous range" onClick={() => { const next = rangeOffset - 1; setRangeOffset(next); overviewReceipt(rangeMode, next); }} data-testid="facilities-range-back"><span aria-hidden="true">←</span></button>
            <strong data-testid="facilities-range-label">{currentRange.label}</strong>
            <button className="icon-button" type="button" aria-label="Next range" onClick={() => { const next = rangeOffset + 1; setRangeOffset(next); overviewReceipt(rangeMode, next); }} data-testid="facilities-range-forward"><span aria-hidden="true">→</span></button>
          </div>
        </div>
        <div className="facilities-filter-row">
          <label>Building<select value={buildingFilter} onChange={(event) => { const value = event.target.value; setBuildingFilter(value); if (roomFilter && facilities.find((item) => item.id === roomFilter)?.building !== value) setRoomFilter(''); overviewReceipt(rangeMode, rangeOffset, value, ''); }} data-testid="facilities-building-filter"><option value="">All buildings</option>{[...new Set(facilities.map((item) => item.building).filter(Boolean))].map((building) => <option key={building} value={building ?? ''}>{building}</option>)}</select></label>
          <label>Room<select value={roomFilter} onChange={(event) => { setRoomFilter(event.target.value); overviewReceipt(rangeMode, rangeOffset, buildingFilter, event.target.value); }} data-testid="facilities-room-filter"><option value="">All rooms</option>{facilities.filter((item) => !buildingFilter || item.building === buildingFilter).map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label>
        </div>
      </section>}

      {mode === 'overview' && <dl className="facilities-metrics" aria-label="Reservation indicators">
        <div><dt>Reservations</dt><dd>{filteredReservations.length}</dd></div>
        <div><dt>Rooms in use</dt><dd>{new Set(filteredReservations.map((item) => item.facilityId)).size}</dd></div>
        <div><dt>Setup</dt><dd data-testid="facilities-metric-setup-notes">{filteredReservations.filter((item) => item.notes).length}</dd></div>
        <div><dt>Conflicts</dt><dd data-testid="facilities-metric-conflicts">{filteredReservations.filter((item) => item.conflicted).length}</dd></div>
        <div className="sr-only"><dt>External changes</dt><dd data-testid="facilities-metric-external">{filteredReservations.filter((item) => item.external).length}</dd></div>
      </dl>}

      <ListInspector
        className="facilities-list-inspector"
        label={mode === 'rooms' ? 'Facility rooms' : 'Facility reservations'}
        items={surfaceState === 'empty' ? [] : mode === 'rooms' ? roomItems : reservationItems}
        groups={mode === 'rooms'
          ? groupedFacilities.map((group) => ({ id: `building-${slug(group.building ?? 'unassigned')}`, label: group.building ?? 'Unassigned' }))
          : reservationGroups}
        selectedId={surfaceState === 'empty' || invalidRoom || invalidReservation ? null : effectiveSelectedItemId}
        onSelect={setSelectedItemId}
        filterItem={mode === 'overview' ? (item) => visibleReservationIds.has(item.id.slice('reservation-'.length)) : undefined}
        loading={surfaceState === 'loading'}
        loadingState={<span data-testid="page-state-loading">Loading Facility reservations</span>}
        error={!readyLike && surfaceState !== 'loading' && surfaceState !== 'empty'
          ? <StatePanel state={surfaceState} onRetry={() => { chooseSurfaceState('ready'); setFacilities(cloneSeededFacilities()); setReservations(cloneSeededReservations()); setReceipts([...initialFacilityReceipts]); }} onAdd={() => openFacilityEditor()} />
          : undefined}
        searchable
        searchPlaceholder={mode === 'rooms' ? 'Search rooms' : 'Search reservations'}
        toolbar={<fieldset className="facilities-list-toolbar" disabled={(!readyLike && surfaceState !== 'empty') || readonly} aria-disabled={(!readyLike && surfaceState !== 'empty') || readonly ? 'true' : 'false'} aria-describedby={readonly ? 'facilities-readonly-reason' : undefined} data-testid="facilities-mutations">
          <legend className="sr-only">{mode === 'rooms' ? 'Room actions' : 'Reservation actions'}</legend>
          {surfaceState === 'empty'
            ? <button className="primary-button" type="button" onClick={() => openFacilityEditor()} data-testid="facilities-empty-add-space">Add Space</button>
            : mode === 'rooms'
            ? <button className="primary-button" type="button" onClick={() => openFacilityEditor()} data-testid="facility-add-space">Add Space</button>
            : <button className="primary-button" type="button" onClick={() => openReservationEditor()} data-testid="facilities-reserve-space">Reserve Space</button>}
        </fieldset>}
        listFooter={<span className="facilities-list-count">{mode === 'rooms' ? `${roomItems.length} spaces` : `${filteredReservations.length} reservations in range`}</span>}
        emptyState={<div className="facilities-local-empty" role="status" data-testid="page-state-empty"><h3>{surfaceState === 'empty' || mode === 'rooms' ? 'No facilities yet' : 'No reservations in this range'}</h3><p>{surfaceState === 'empty' || mode === 'rooms' ? 'Add the first space to make room reservations available.' : 'Change the date range or clear a room filter to inspect another part of the schedule.'}</p></div>}
        noResultsState={mode === 'overview' ? <div className="facilities-local-empty" role="status"><h3>No reservations in this range</h3><p>Change the date range or clear a room filter to inspect another part of the schedule.</p></div> : undefined}
        inspector={(item) => {
          if (invalidReservation || invalidRoom) return <section className="facilities-not-found" role="status" data-testid={invalidReservation ? 'facility-reservation-not-found' : 'facility-room-not-found'}><h3>{invalidReservation ? 'Reservation' : 'Room'} not found</h3><p>The requested {invalidReservation ? 'reservation' : 'room'} is not in the current workspace.</p><button className="secondary-button" type="button" onClick={() => navigate(invalidReservation ? '/facilities' : '/facilities/rooms')} data-testid="facilities-back">Back to facilities</button></section>;
          if (!item) return <div className="facilities-inspector-empty"><span>Select an item</span><p>Choose a compact row to inspect its details and actions.</p></div>;
          if (item.id.startsWith('reservation-')) {
            const reservation = reservations.find((entry) => `reservation-${entry.id}` === item.id);
            if (!reservation) return null;
            const facility = facilities.find((entry) => entry.id === reservation.facilityId);
            return <section className="facilities-detail-sheet" data-testid="facility-reservation-detail">
              <span className="sr-only">{reservation.title}</span>
              <div className="facilities-detail-heading"><div><span>{reservation.seriesId ? 'Recurring series' : reservation.groupId ? 'Linked room group' : 'Reservation'}</span><p>{facility?.name} · {facility?.building ?? 'Unassigned'}</p></div><div className="facilities-detail-actions">{!readonly && reservationActions(reservation)}{reservation.seriesId
                ? <button className="text-danger-button" type="button" disabled={readonly} onClick={() => setDeleteSeriesTarget(reservation)} data-testid="facility-series-delete">Delete entire series</button>
                : <button className="text-danger-button" type="button" disabled={readonly} onClick={() => setDeleteReservationTarget(reservation)} data-testid="facility-reservation-delete">{reservation.groupId ? 'Delete reservation group' : 'Delete reservation'}</button>}</div></div>
              <dl className="facilities-detail-grid">
                <div><dt>Room</dt><dd>{facility?.name}</dd></div><div><dt>Date</dt><dd>{displayDate(reservation.start)}</dd></div>
                <div><dt>Time</dt><dd><Timestamp value={wallClockInstant(reservation.start)?.toISOString()} />–<Timestamp value={wallClockInstant(reservation.end)?.toISOString()} /></dd></div><div><dt>Requester</dt><dd>{reservation.requesterName}</dd></div>
                <div className="span-all"><dt>Setup notes</dt><dd>{reservation.notes || 'No setup notes'}</dd></div>
                {reservation.conflicted && <div className="span-all facilities-conflict-note"><dt>Availability</dt><dd aria-live="polite">Conflict detected for this reservation.</dd></div>}
              </dl>
              <form className="facilities-reservation-form facilities-direct-editor" onSubmit={submitReservation} data-testid="facility-reservation-direct-editor"><fieldset disabled={readonly} aria-describedby={readonly ? 'facilities-readonly-reason' : undefined}><legend className="sr-only">Reservation details</legend><div className="facilities-form-grid"><label className="field span-2">Title<input value={reservationTitle} onChange={(event) => setReservationTitle(event.target.value)} data-testid="facility-reservation-title" /></label><label className="field span-2">Requester<input value={requesterName} onChange={(event) => setRequesterName(event.target.value)} readOnly={!manager} data-testid="facility-reservation-requester" /></label><label className="field">Date<input type="date" value={reservationDate} onChange={(event) => setReservationDate(event.target.value)} data-testid="facility-reservation-date" /></label><label className="field">Start time<input type="time" value={reservationStart} onChange={(event) => setReservationStart(event.target.value)} data-testid="facility-reservation-start" /></label><label className="field">End time<input type="time" value={reservationEnd} onChange={(event) => setReservationEnd(event.target.value)} data-testid="facility-reservation-end" /></label><label className="field span-2">Setup notes<textarea rows={3} value={reservationNotes} onChange={(event) => setReservationNotes(event.target.value)} data-testid="facility-reservation-notes" /></label></div><section className={`facilities-availability ${selectedConflicts.length ? 'conflict' : ''}`} aria-live="polite"><div><h3>Availability</h3><strong data-testid="facility-availability-status">{reservationStart && reservationEnd ? selectedConflicts.length ? `${selectedConflicts.length} reservation overlaps the selected slot` : 'Selected slot is open' : 'Choose a start and end time'}</strong></div></section><footer className="dialog-actions"><button className="primary-button" type="submit" data-testid="facility-reservation-submit">Save changes</button></footer></fieldset></form>
            </section>;
          }
          const room = facilities.find((entry) => `room-${entry.id}` === item.id);
          if (!room) return null;
          const upcoming = reservations.filter((entry) => entry.facilityId === room.id && !entry.automation);
          return <section className="facilities-detail-sheet room-detail" data-testid="facility-room-detail">
            <span className="sr-only">{room.name}</span>
            <div className="facilities-detail-heading"><div><span>{room.building ?? 'Unassigned'}</span><p>{room.description}</p></div><div className="facilities-detail-actions"><button className="primary-button" type="button" disabled={readonly} onClick={() => openReservationEditor(room.id)} data-testid="facility-room-reserve">Reserve this room</button>{!readonly && manager && <ActionMenu label={`Manage ${room.name}`} testId={`facility-room-actions-${room.id}`}><button className="menu-item danger-item" role="menuitem" type="button" onClick={() => setDeleteFacilityTarget(room)} data-testid={`facility-room-delete-${room.id}`}>Delete room</button></ActionMenu>}</div></div>
            <form className="facilities-editor-form facilities-direct-editor" onSubmit={submitFacility} data-testid="facility-room-direct-editor"><fieldset disabled={readonly} aria-describedby={readonly ? 'facilities-readonly-reason' : undefined}><legend className="sr-only">Room details</legend><label className="field">Room name<input value={facilityName} onChange={(event) => { setFacilityName(event.target.value); setFacilityNameError(''); }} data-testid="facility-name" /></label><label className="field">Building<select value={facilityBuilding} onChange={(event) => setFacilityBuilding(event.target.value)} data-testid="facility-building"><option value="">Unassigned</option>{[...new Set(facilities.map((facility) => facility.building).filter(Boolean))].map((building) => <option key={building} value={building ?? ''}>{building}</option>)}</select></label><label className="field">Description<textarea rows={4} value={facilityDescription} onChange={(event) => setFacilityDescription(event.target.value)} data-testid="facility-description" /></label><footer className="dialog-actions"><button className="primary-button" type="submit" data-testid="facility-editor-submit">Save changes</button></footer></fieldset></form>
            <div className="facilities-room-preview"><div className="facilities-inspector-section-heading"><h3>Upcoming reservations</h3><span>{upcoming.length}</span></div>{upcoming.slice(0, 5).map((reservation) => <button type="button" key={reservation.id} data-reservation-preview="true" onClick={() => { setMode('overview'); setSelectedItemId(`reservation-${reservation.id}`); }}><strong>{reservation.title}</strong><span><Timestamp value={wallClockInstant(reservation.start)?.toISOString()} /></span></button>)}</div>
            <button className="secondary-button" type="button" disabled={readonly} onClick={openAutomation} data-testid="facility-automation-manage">Manage automation reservations</button>
          </section>;
        }}
      />

      <span className="facilities-responsive-primary" id="facilities-responsive-primary" data-testid="facilities-responsive-primary">Rooms and schedule available</span>
      <output className="facilities-trace" aria-live="polite" aria-label="Facilities fixture endpoint receipts" data-testid="page-trace" tabIndex={0}><span>Request log</span><ol>{receipts.map((receipt, index) => <li key={`${receipt}-${index}`}>{receipt}</li>)}</ol></output>

      <FocusDialog open={reservationDialogOpen} title={reservationMode === 'series' ? 'Edit recurring series' : reservationMode === 'reservation' || reservationMode === 'group' ? 'Edit reservation' : 'Reserve space'} description="Availability is calculated from the current room schedule." onClose={closeReservationEditor} testId="facility-reservation-dialog" wide>
        <form className="facilities-reservation-form" onSubmit={submitReservation}>
          {/* Lead fix: the contract's Shift+Tab-from-title trap check expects a header close control. */}
          <header className="facilities-dialog-header">
            <button className="icon-button" type="button" onClick={closeReservationEditor} aria-label="Close reservation dialog" data-testid="facility-reservation-close"><Icon name="close" /></button>
          </header>
          <div className="facilities-form-grid">
            <label className="field span-2">Title<input data-autofocus value={reservationTitle} onChange={(event) => setReservationTitle(event.target.value)} aria-invalid={Boolean(formErrors.title)} aria-describedby={formErrors.title ? 'facility-title-error' : undefined} data-testid="facility-reservation-title" />{formErrors.title && <span className="facilities-field-error" id="facility-title-error" data-testid="facility-reservation-title-error">{formErrors.title}</span>}</label>
            <label className="field span-2">Requester<input value={requesterName} onChange={(event) => setRequesterName(event.target.value)} readOnly={!manager} data-testid="facility-reservation-requester" />{formErrors.requester && <span className="facilities-field-error" role="alert">{formErrors.requester}</span>}</label>
            <label className="field">Date<input type="date" value={reservationDate} onChange={(event) => setReservationDate(event.target.value)} data-testid="facility-reservation-date" /></label>
            <label className="field">Start time<input type="time" value={reservationStart} onChange={(event) => setReservationStart(event.target.value)} data-testid="facility-reservation-start" /></label>
            <label className="field">End time<input type="time" value={reservationEnd} onChange={(event) => setReservationEnd(event.target.value)} data-testid="facility-reservation-end" /></label>
            <label className="field span-2">Setup notes<textarea rows={3} value={reservationNotes} onChange={(event) => setReservationNotes(event.target.value)} data-testid="facility-reservation-notes" /></label>
          </div>
          <fieldset className="facilities-room-choices"><legend>Rooms</legend><div className="facilities-room-choice-actions"><button className="text-button" type="button" onClick={() => setSelectedRoomIds(facilities.map((facility) => facility.id))} data-testid="facility-room-select-all">Select all</button><button className="text-button" type="button" onClick={() => setSelectedRoomIds([])} data-testid="facility-room-clear">Clear</button></div>{facilities.map((facility) => <label key={facility.id}><input type="checkbox" checked={selectedRoomIds.includes(facility.id)} disabled={reservationMode === 'reservation' || reservationMode === 'series'} onChange={() => setSelectedRoomIds((current) => current.includes(facility.id) ? current.filter((id) => id !== facility.id) : [...current, facility.id])} data-testid={`facility-room-choice-${facility.id}`} /><span><strong>{facility.name}</strong><small>{facility.building ?? 'Unassigned'}</small></span></label>)}{formErrors.room && <span className="facilities-field-error" id="facility-room-error" role="alert" data-testid="facility-room-error">{formErrors.room}</span>}</fieldset>
          <section className={`facilities-availability ${selectedConflicts.length ? 'conflict' : ''}`} aria-live="polite"><div><h3>Availability</h3><strong data-testid="facility-availability-status">{reservationStart && reservationEnd ? selectedConflicts.length ? `${selectedConflicts.length} reservation overlaps the selected slot` : 'Selected slot is open' : 'Choose a start and end time'}</strong></div>{selectedRoomIds.map((id) => <div key={id} data-testid={`facility-availability-room-${id}`}><strong>{facilities.find((facility) => facility.id === id)?.name}</strong><span>{reservations.filter((item) => item.facilityId === id && dateOnly(item.start) === reservationDate && !item.automation).map((item) => `${item.title} ${displayTime(item.start)}-${displayTime(item.end)}`).join(' · ') || 'No reservations that day'}</span></div>)}</section>
          {reservationMode !== 'reservation' && reservationMode !== 'group' && <section className="facilities-recurrence"><label className="facilities-switch"><input type="checkbox" checked={recurring} disabled={reservationMode === 'series'} onChange={(event) => setRecurring(event.target.checked)} data-testid="facility-recurring-toggle" /><span>Recurring reservation</span></label>{recurring && <><div className="facilities-recurrence-types" aria-label="Recurrence type">{(['weekly', 'biweekly', 'monthly', 'custom'] as RecurrenceType[]).map((type) => <button type="button" key={type} aria-pressed={recurrenceType === type} onClick={() => setRecurrenceType(type)} data-testid={`facility-recurrence-${type}`}>{type === 'biweekly' ? 'Bi-weekly' : type[0].toUpperCase() + type.slice(1)}</button>)}</div>{recurrenceType !== 'custom' ? <label className="field">Series end<input type="date" value={seriesEnd} onChange={(event) => setSeriesEnd(event.target.value)} data-testid="facility-series-end" /></label> : <div className="facilities-custom-dates"><div className="facilities-date-chips">{[...new Set([reservationDate, ...customDates])].filter(Boolean).map((date) => <span key={date} data-testid={`facility-custom-date-${date}`}>{date}{date !== reservationDate && <button type="button" aria-label={`Remove ${date}`} onClick={() => setCustomDates((current) => current.filter((item) => item !== date))} data-testid={`facility-custom-date-remove-${date}`}>×</button>}</span>)}</div>{customDateOpen ? <div className="facilities-custom-date-entry"><label className="sr-only" htmlFor="facility-custom-date-input">Additional date</label><input id="facility-custom-date-input" type="date" value={customDateInput} onChange={(event) => setCustomDateInput(event.target.value)} data-testid="facility-custom-date-input" /><button className="secondary-button" type="button" onClick={() => { if (customDateInput && customDateInput !== reservationDate) setCustomDates((current) => [...new Set([...current, customDateInput])]); setCustomDateOpen(false); }} data-testid="facility-custom-date-confirm">Add date</button></div> : <button className="secondary-button" type="button" onClick={() => setCustomDateOpen(true)} data-testid="facility-custom-date-add">Add custom date</button>}</div>}</>}</section>}
          {formErrors.slot && <div className="facilities-form-alert" role="alert">{formErrors.slot}</div>}
          <footer className="dialog-actions"><button className="secondary-button" type="button" onClick={closeReservationEditor} data-testid="facility-reservation-cancel">Cancel</button><button className="primary-button" type="submit" data-testid="facility-reservation-submit">{reservationMode === 'create' ? 'Create reservation' : 'Save changes'}</button></footer>
        </form>
      </FocusDialog>

      <FocusDialog open={facilityEditorOpen} title={editingFacility ? 'Edit space' : 'Add space'} description="Facilities use only the room name, building, and description fields exposed by Rhythm." onClose={() => setFacilityEditorOpen(false)} testId="facility-editor-dialog">
        <form className="facilities-editor-form" onSubmit={submitFacility}>
          <label className="field">Room name<input data-autofocus value={facilityName} onChange={(event) => { setFacilityName(event.target.value); setFacilityNameError(''); }} aria-invalid={Boolean(facilityNameError)} aria-describedby={facilityNameError ? 'facility-name-error' : undefined} data-testid="facility-name" />{facilityNameError && <span className="facilities-field-error" id="facility-name-error" role="alert" data-testid="facility-name-error">{facilityNameError}</span>}</label>
          <label className="field">Building<select value={facilityBuilding} onChange={(event) => setFacilityBuilding(event.target.value)} data-testid="facility-building"><option value="">Unassigned</option>{[...new Set(facilities.map((facility) => facility.building).filter(Boolean))].map((building) => <option key={building} value={building ?? ''}>{building}</option>)}<option value="__new_building__">Add a new building…</option></select></label>
          {facilityBuilding === '__new_building__' && <label className="field">New building name<input value={newBuilding} onChange={(event) => setNewBuilding(event.target.value)} data-testid="facility-new-building" /></label>}
          <label className="field">Description<textarea rows={4} value={facilityDescription} onChange={(event) => setFacilityDescription(event.target.value)} data-testid="facility-description" /></label>
          <footer className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setFacilityEditorOpen(false)} data-testid="facility-editor-cancel">Cancel</button><button className="primary-button" type="submit" data-testid="facility-editor-submit">{editingFacility ? 'Save changes' : 'Add Space'}</button></footer>
        </form>
      </FocusDialog>

      <FocusDialog open={automationOpen} title="Manage automation reservations" description="Preview the exact cleanup scope before deleting automation-created reservations." onClose={() => setAutomationOpen(false)} testId="facility-automation-dialog" wide>
        <div className="facilities-automation-form">
          <div className="facilities-form-grid">
            <label className="field">Room<select value={automationRoom} onChange={(event) => { setAutomationRoom(event.target.value); previewReceipt(event.target.value, automationStart, automationEnd); }} data-testid="facility-automation-room-filter"><option value="">All rooms</option>{facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label>
            <label className="field">Start after<input type="date" value={automationStart} onChange={(event) => { setAutomationStart(event.target.value); previewReceipt(automationRoom, event.target.value, automationEnd); }} data-testid="facility-automation-start-after" /></label>
            <label className="field">End before<input type="date" value={automationEnd} onChange={(event) => { setAutomationEnd(event.target.value); previewReceipt(automationRoom, automationStart, event.target.value); }} data-testid="facility-automation-end-before" /></label>
          </div>
          {filteredAutomation.length ? <section className="facilities-automation-preview" aria-live="polite"><div><span>Reservations in scope</span><strong data-testid="facility-automation-total">{filteredAutomation.length}</strong></div><div data-testid="facility-automation-by-room">{facilities.map((facility) => { const count = filteredAutomation.filter((item) => item.facilityId === facility.id).length; return count ? <p key={facility.id}>{facility.name}: {count}</p> : null; })}</div></section> : <section className="facilities-automation-zero" role="status" data-testid="facility-automation-zero"><h3>No automation-created reservations</h3><p>Adjust the room or date bounds to preview a different cleanup scope.</p></section>}
          <footer className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setAutomationOpen(false)} data-testid="facility-automation-cancel">Cancel</button>{filteredAutomation.length > 0 && <button className="danger-button" type="button" onClick={cleanupAutomation} data-testid="facility-automation-delete">Delete {filteredAutomation.length} reservations</button>}</footer>
        </div>
      </FocusDialog>

      {groupSummary && <FocusDialog open title="Linked room result" description="The server applied the booking only where the selected slot was available." onClose={() => setGroupSummary(null)} testId="facility-group-summary"><p className="facilities-result-copy">{groupSummary}</p><div className="dialog-actions"><button className="primary-button" type="button" onClick={() => setGroupSummary(null)} data-testid="facility-group-summary-done">Done</button></div></FocusDialog>}
      {recurringSummary && <FocusDialog open title="Recurring reservation result" description="The whole series was materialized from the selected recurrence pattern." onClose={() => setRecurringSummary(null)} testId="facility-recurring-summary"><p className="facilities-result-copy">{recurringSummary}</p><div className="dialog-actions"><button className="primary-button" type="button" onClick={() => setRecurringSummary(null)} data-testid="facility-recurring-summary-done">Done</button></div></FocusDialog>}
      <ConfirmDialog item={deleteFacilityTarget} kind="room" onClose={() => setDeleteFacilityTarget(null)} onConfirm={deleteFacility} />
      <ConfirmDialog item={deleteReservationTarget} kind="reservation" onClose={() => setDeleteReservationTarget(null)} onConfirm={deleteReservation} />
      <ConfirmDialog item={deleteSeriesTarget} kind="series" onClose={() => setDeleteSeriesTarget(null)} onConfirm={deleteSeries} />
    </section>
  );
}
