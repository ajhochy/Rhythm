// Ported from apps/web/src/pages/facilities/index.tsx (704 lines) — see SOURCE_MAP.md for what
// carried over vs. what was deliberately dropped at the host-neutral boundary: multi-room
// "linked group" bookings, weekly/biweekly/monthly/custom recurring-series creation, and the
// editable requester-name field (this screen's CreateReservationInput has no requester field;
// the gateway assigns it) are all host/transport-shaped features the narrower FacilitiesGateway
// does not carry. "Delete entire series" is reconstructed here from the plain single-reservation
// deleteReservation primitive (looped across every reservation sharing a seriesId) rather than a
// dedicated series-delete endpoint. Facility (room) create/update/delete is a minimal additive
// gateway addition — see src/domain/types.ts — because Facilities' own namesake capability
// (managing rooms, not just reservations) would otherwise be entirely unimplemented.
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useRhythmDomainGateway } from '../context';
import { ScreenRoot } from './ScreenRoot';
import { Icon } from '../components/Icon';
import { FocusDialog } from '../components/FocusDialog';
import { RhythmGatewayError, type RhythmFacility, type RhythmReservation } from '../domain/types';

type SurfaceState = 'loading' | 'ready' | 'empty' | 'forbidden' | 'unavailable' | 'server_error';
type Mode = 'overview' | 'rooms';
type RangeMode = 'day' | 'week' | 'month';

// A fixed reference date (not wall-clock "today") keeps this screen's default schedule window
// deterministic — matching the fixed window the seeded fixture reservations were authored
// around — the same reason apps/web/src/pages/facilities/fixtures.ts pins its own anchor.
const ANCHOR = '2026-08-12';
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatIsoDate(iso: string): string {
  const parts = iso.split('-').map(Number);
  const year = parts[0] ?? 0;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return `${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}

function computeRange(mode: RangeMode, offset: number): { start: string; end: string; label: string } {
  if (mode === 'day') {
    const day = addDaysIso(ANCHOR, offset);
    return { start: day, end: day, label: formatIsoDate(day) };
  }
  if (mode === 'week') {
    const anchorDow = new Date(`${ANCHOR}T00:00:00Z`).getUTCDay();
    const mondayOffset = anchorDow === 0 ? -6 : 1 - anchorDow;
    const monday = addDaysIso(ANCHOR, mondayOffset + offset * 7);
    const sunday = addDaysIso(monday, 6);
    return { start: monday, end: sunday, label: `${formatIsoDate(monday)} – ${formatIsoDate(sunday)}` };
  }
  const anchorDate = new Date(`${ANCHOR}T00:00:00Z`);
  const monthStart = new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth() + offset, 1));
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));
  return {
    start: monthStart.toISOString().slice(0, 10),
    end: monthEnd.toISOString().slice(0, 10),
    label: `${MONTH_NAMES[monthStart.getUTCMonth()]} ${monthStart.getUTCFullYear()}`,
  };
}

function dateOnly(value: string) {
  return value.slice(0, 10);
}

function timeOnly(value: string) {
  return value.slice(11, 16);
}

function displayTime(value: string) {
  const [hourText, minute] = timeOnly(value).split(':');
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function slug(value: string) {
  return value.toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unassigned';
}

function ActionMenu({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const closeWithEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeWithEscape);
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus());
    return () => { document.removeEventListener('mousedown', closeOutside); document.removeEventListener('keydown', closeWithEscape); };
  }, [open]);

  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
    if (!items.length) return;
    event.preventDefault();
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div className="facilities-menu-anchor" ref={rootRef}>
      <button ref={triggerRef} className="icon-button" type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} data-testid={testId}>
        <Icon name="more" size={16} />
      </button>
      {open && (
        <div className="menu-popover facilities-menu" role="menu" aria-label={label} onKeyDown={moveFocus} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

function StatePanel({ state, onRetry }: { state: Exclude<SurfaceState, 'ready'>; onRetry(): void }) {
  if (state === 'loading') {
    return <section className="facilities-state" role="status" aria-live="polite" data-testid="page-state-loading"><h2>Loading facilities</h2><p>Gathering rooms and the current reservation schedule.</p></section>;
  }
  if (state === 'empty') {
    return <section className="facilities-state" role="status" data-testid="page-state-empty"><h2>No facilities yet</h2><p>Add the first space to make room reservations available to this workspace.</p></section>;
  }
  if (state === 'server_error') {
    return <section className="facilities-state danger" role="alert" data-testid="page-state-server-error"><h2>Facilities could not be loaded</h2><p>The schedule service returned a temporary error.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
  }
  if (state === 'forbidden') {
    return <section className="facilities-state warning" role="alert" data-testid="page-state-forbidden"><h2>Workspace access required</h2><p>Join an authenticated Rhythm workspace before inspecting its facilities.</p></section>;
  }
  return <section className="facilities-state warning" role="status" data-testid="page-state-unavailable"><h2>Facilities are unavailable</h2><p>Reconnect the facilities service before loading or changing this schedule.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
}

export function FacilitiesScreen() {
  const { facilities: gateway } = useRhythmDomainGateway();
  const [surfaceState, setSurfaceState] = useState<SurfaceState>('loading');
  const [facilities, setFacilities] = useState<RhythmFacility[]>([]);
  const [reservations, setReservations] = useState<RhythmReservation[]>([]);
  const [mode, setMode] = useState<Mode>('overview');
  const [rangeMode, setRangeMode] = useState<RangeMode>('week');
  const [rangeOffset, setRangeOffset] = useState(0);
  const [buildingFilter, setBuildingFilter] = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const [selectedReservationId, setSelectedReservationId] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);

  const [reservationDialogOpen, setReservationDialogOpen] = useState(false);
  const [editingReservation, setEditingReservation] = useState<RhythmReservation | null>(null);
  const [formRoomId, setFormRoomId] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formStart, setFormStart] = useState('');
  const [formEnd, setFormEnd] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [deleteReservationTarget, setDeleteReservationTarget] = useState<RhythmReservation | null>(null);
  const [deleteSeriesTarget, setDeleteSeriesTarget] = useState<RhythmReservation | null>(null);

  const [facilityEditorOpen, setFacilityEditorOpen] = useState(false);
  const [editingFacility, setEditingFacility] = useState<RhythmFacility | null>(null);
  const [facilityName, setFacilityName] = useState('');
  const [facilityBuilding, setFacilityBuilding] = useState('');
  const [newBuilding, setNewBuilding] = useState('');
  const [facilityDescription, setFacilityDescription] = useState('');
  const [facilityNameError, setFacilityNameError] = useState('');
  const [deleteFacilityTarget, setDeleteFacilityTarget] = useState<RhythmFacility | null>(null);

  const [automationOpen, setAutomationOpen] = useState(false);
  const [automationRoom, setAutomationRoom] = useState('');
  const [automationStart, setAutomationStart] = useState('');
  const [automationEnd, setAutomationEnd] = useState('');

  const [mutationPending, setMutationPending] = useState(false);

  const currentRange = computeRange(rangeMode, rangeOffset);

  const handleError = (error: unknown) => {
    const kind = error instanceof RhythmGatewayError ? error.kind : 'server_error';
    setSurfaceState(kind === 'forbidden' ? 'forbidden' : kind === 'not_found' ? 'unavailable' : kind === 'unavailable' ? 'unavailable' : 'server_error');
  };

  const load = async () => {
    setSurfaceState('loading');
    try {
      const [loadedFacilities, loadedReservations] = await Promise.all([gateway.facilities(), gateway.reservations({ start: `${currentRange.start}T00:00:00.000`, end: `${currentRange.end}T23:59:59.999` })]);
      setFacilities(loadedFacilities);
      setReservations(loadedReservations);
      setSurfaceState(loadedFacilities.length ? 'ready' : 'empty');
    } catch (error) {
      handleError(error);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [gateway]);

  const showsWorkspace = surfaceState === 'ready';

  const visibleReservations = reservations
    .filter((reservation) => !reservation.automation)
    .filter((reservation) => {
      const facility = facilities.find((item) => item.id === reservation.facilityId);
      if (!facility) return false;
      if (buildingFilter && facility.building !== buildingFilter) return false;
      if (roomFilter && reservation.facilityId !== roomFilter) return false;
      const date = dateOnly(reservation.start);
      return date >= currentRange.start && date <= currentRange.end;
    })
    .sort((left, right) => left.start.localeCompare(right.start));

  const roomsInUse = new Set(visibleReservations.map((reservation) => reservation.facilityId)).size;
  const setupNotesCount = visibleReservations.filter((reservation) => reservation.notes).length;
  const conflictsCount = visibleReservations.filter((reservation) => reservation.conflicted).length;

  const selectedReservation = reservations.find((reservation) => reservation.id === selectedReservationId) ?? null;
  const selectedRoom = facilities.find((facility) => facility.id === selectedRoomId) ?? null;

  const buildings = [...new Set(facilities.map((facility) => facility.building).filter((value): value is string => Boolean(value)))].sort();
  const groupedFacilities = [...buildings, null].map((building) => ({
    building,
    facilities: facilities.filter((facility) => facility.building === building).sort((left, right) => left.name.localeCompare(right.name)),
  })).filter((group) => group.facilities.length > 0);

  const clearFilters = () => {
    setRangeMode('week');
    setRangeOffset(0);
    setBuildingFilter('');
    setRoomFilter('');
  };

  const openReservationEditor = (reservation: RhythmReservation | null, presetFacilityId?: string) => {
    setEditingReservation(reservation);
    setFormRoomId(reservation?.facilityId ?? presetFacilityId ?? facilities[0]?.id ?? '');
    setFormTitle(reservation?.title ?? '');
    setFormDate(reservation ? dateOnly(reservation.start) : currentRange.start);
    setFormStart(reservation ? timeOnly(reservation.start) : '');
    setFormEnd(reservation ? timeOnly(reservation.end) : '');
    setFormNotes(reservation?.notes ?? '');
    setFormErrors({});
    setReservationDialogOpen(true);
  };
  const closeReservationEditor = () => {
    setReservationDialogOpen(false);
    setEditingReservation(null);
    setFormErrors({});
  };

  const formConflicts = formStart && formEnd
    ? reservations.filter((reservation) =>
        reservation.facilityId === formRoomId &&
        !reservation.automation &&
        reservation.id !== editingReservation?.id &&
        dateOnly(reservation.start) === formDate &&
        timeOnly(reservation.start) < formEnd &&
        timeOnly(reservation.end) > formStart)
    : [];
  const availabilityText = !formStart || !formEnd
    ? 'Choose a start and end time'
    : formConflicts.length
      ? `${formConflicts.length} reservation${formConflicts.length === 1 ? '' : 's'} overlap the selected slot`
      : 'Selected slot is open';

  const submitReservation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!formRoomId) errors.room = 'Select a room';
    if (!formTitle.trim()) errors.title = 'Title is required';
    if (!formDate || !formStart || !formEnd) errors.slot = 'Choose a date, start time, and end time';
    else if (formEnd <= formStart) errors.slot = 'End time must be after the start time';
    else if (!editingReservation && formConflicts.length) errors.slot = `${formTitle || 'This reservation'} overlaps an existing reservation`;
    setFormErrors(errors);
    if (Object.keys(errors).length) return;

    setMutationPending(true);
    try {
      const start = `${formDate}T${formStart}:00-07:00`;
      const end = `${formDate}T${formEnd}:00-07:00`;
      if (editingReservation) {
        const updated = await gateway.updateReservation(editingReservation.id, { title: formTitle.trim(), start, end, notes: formNotes || null });
        setReservations((current) => current.map((reservation) => (reservation.id === updated.id ? updated : reservation)));
      } else {
        const created = await gateway.createReservation({ facilityId: formRoomId, title: formTitle.trim(), start, end, notes: formNotes || undefined });
        setReservations((current) => [...current, created]);
      }
      closeReservationEditor();
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const confirmDeleteReservation = async () => {
    if (!deleteReservationTarget) return;
    setMutationPending(true);
    try {
      await gateway.deleteReservation(deleteReservationTarget.id);
      setReservations((current) => current.filter((reservation) => reservation.id !== deleteReservationTarget.id));
      if (selectedReservationId === deleteReservationTarget.id) setSelectedReservationId(null);
      setDeleteReservationTarget(null);
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const confirmDeleteSeries = async () => {
    if (!deleteSeriesTarget?.seriesId) return;
    setMutationPending(true);
    try {
      const seriesId = deleteSeriesTarget.seriesId;
      const memberIds = reservations.filter((reservation) => reservation.seriesId === seriesId).map((reservation) => reservation.id);
      await Promise.all(memberIds.map((id) => gateway.deleteReservation(id)));
      setReservations((current) => current.filter((reservation) => reservation.seriesId !== seriesId));
      if (selectedReservationId && memberIds.includes(selectedReservationId)) setSelectedReservationId(null);
      setDeleteSeriesTarget(null);
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const openFacilityEditor = (facility: RhythmFacility | null) => {
    setEditingFacility(facility);
    setFacilityName(facility?.name ?? '');
    setFacilityBuilding(facility?.building ?? '');
    setNewBuilding('');
    setFacilityDescription(facility?.description ?? '');
    setFacilityNameError('');
    setFacilityEditorOpen(true);
  };
  const closeFacilityEditor = () => setFacilityEditorOpen(false);

  const submitFacility = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!facilityName.trim()) {
      setFacilityNameError('Room name is required');
      return;
    }
    const building = facilityBuilding === '__new_building__' ? newBuilding.trim() : facilityBuilding;
    setMutationPending(true);
    try {
      if (editingFacility) {
        const updated = await gateway.updateFacility(editingFacility.id, { name: facilityName.trim(), building: building || null, description: facilityDescription.trim() });
        setFacilities((current) => current.map((facility) => (facility.id === updated.id ? updated : facility)));
      } else {
        const created = await gateway.createFacility({ name: facilityName.trim(), building: building || null, description: facilityDescription.trim() });
        setFacilities((current) => [...current, created]);
      }
      setFacilityEditorOpen(false);
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const confirmDeleteFacility = async () => {
    if (!deleteFacilityTarget) return;
    setMutationPending(true);
    try {
      await gateway.deleteFacility(deleteFacilityTarget.id);
      setFacilities((current) => current.filter((facility) => facility.id !== deleteFacilityTarget.id));
      setReservations((current) => current.filter((reservation) => reservation.facilityId !== deleteFacilityTarget.id));
      if (selectedRoomId === deleteFacilityTarget.id) setSelectedRoomId(null);
      setDeleteFacilityTarget(null);
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
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
    setAutomationRoom('');
    setAutomationStart('');
    setAutomationEnd('');
    setAutomationOpen(true);
  };

  const cleanupAutomation = async () => {
    const targets = filteredAutomation.map((reservation) => reservation.id);
    setMutationPending(true);
    try {
      await Promise.all(targets.map((id) => gateway.deleteReservation(id)));
      setReservations((current) => current.filter((reservation) => !targets.includes(reservation.id)));
      setAutomationOpen(false);
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  return (
    <ScreenRoot screenName="Facilities" testId="rhythm-facilities-screen">
      <section className="page-shell pg-facilities" aria-busy={surfaceState === 'loading'}>
        <header className="facilities-header">
          <div className="facilities-heading">
            <h1>Facilities</h1>
            <p>Coordinate rooms and setup-sensitive reservations.</p>
          </div>
          <fieldset className="facilities-mutation-gate" disabled={!showsWorkspace || mutationPending}>
            <legend className="sr-only">Facilities actions</legend>
            <button className="primary-button" type="button" onClick={() => openReservationEditor(null)} data-testid="facilities-reserve-space">Reserve Space</button>
          </fieldset>
        </header>

        {!showsWorkspace && <StatePanel state={surfaceState} onRetry={() => void load()} />}

        {showsWorkspace && (
          <>
            <nav className="facilities-mode-switch" aria-label="Facilities views">
              <button type="button" aria-pressed={mode === 'overview'} onClick={() => setMode('overview')} data-testid="facilities-mode-overview">Overview</button>
              <button type="button" aria-pressed={mode === 'rooms'} onClick={() => setMode('rooms')} data-testid="facilities-mode-rooms">Rooms</button>
            </nav>

            {mode === 'overview' ? (
              <div className="facilities-split-shell">
                <div className="facilities-list-pane">
                  <section className="facilities-command-deck" aria-label="Schedule range and filters">
                    <div className="facilities-range-controls">
                      <div className="facilities-segmented" aria-label="Schedule range">
                        {(['day', 'week', 'month'] as RangeMode[]).map((range) => (
                          <button key={range} type="button" aria-pressed={rangeMode === range} onClick={() => { setRangeMode(range); setRangeOffset(0); }} data-testid={`facilities-range-${range}`}>
                            {range.charAt(0).toUpperCase() + range.slice(1)}
                          </button>
                        ))}
                      </div>
                      <div className="facilities-period-nav">
                        <button className="icon-button" type="button" aria-label="Previous range" onClick={() => setRangeOffset((value) => value - 1)} data-testid="facilities-range-back"><Icon name="chevronRight" size={14} style={{ transform: 'rotate(180deg)' }} /></button>
                        <strong data-testid="facilities-range-label">{currentRange.label}</strong>
                        <button className="icon-button" type="button" aria-label="Next range" onClick={() => setRangeOffset((value) => value + 1)} data-testid="facilities-range-forward"><Icon name="chevronRight" size={14} /></button>
                      </div>
                    </div>
                    <div className="facilities-filter-row">
                      <label>Building
                        <select value={buildingFilter} onChange={(event) => { setBuildingFilter(event.target.value); }} data-testid="facilities-building-filter">
                          <option value="">All buildings</option>
                          {buildings.map((building) => <option key={building} value={building}>{building}</option>)}
                        </select>
                      </label>
                      <label>Room
                        <select value={roomFilter} onChange={(event) => setRoomFilter(event.target.value)} data-testid="facilities-room-filter">
                          <option value="">All rooms</option>
                          {facilities.filter((facility) => !buildingFilter || facility.building === buildingFilter).map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}
                        </select>
                      </label>
                    </div>
                  </section>

                  <dl className="facilities-metrics" aria-label="Reservation indicators">
                    <div><dt>Reservations</dt><dd data-testid="facilities-metric-reservations">{visibleReservations.length}</dd></div>
                    <div><dt>Rooms in use</dt><dd data-testid="facilities-metric-rooms-in-use">{roomsInUse}</dd></div>
                    <div><dt>Setup</dt><dd data-testid="facilities-metric-setup-notes">{setupNotesCount}</dd></div>
                    <div><dt>Conflicts</dt><dd data-testid="facilities-metric-conflicts">{conflictsCount}</dd></div>
                  </dl>

                  <section className="facilities-schedule" aria-labelledby="facilities-schedule-title">
                    <header><h2 id="facilities-schedule-title">Schedule</h2><p>{visibleReservations.length} visible reservation{visibleReservations.length === 1 ? '' : 's'}</p></header>
                    <div className="facilities-reservation-list" data-testid="facilities-overview-results">
                      {visibleReservations.length ? visibleReservations.map((reservation) => {
                        const facility = facilities.find((item) => item.id === reservation.facilityId);
                        return (
                          <article className="facilities-reservation-row" key={reservation.id} aria-current={selectedReservationId === reservation.id ? 'true' : undefined} data-testid={`facility-reservation-${reservation.id}`}>
                            <button className="facilities-reservation-open" type="button" onClick={() => setSelectedReservationId(reservation.id)} data-testid={`facility-reservation-open-${reservation.id}`}>
                              <time dateTime={reservation.start}><strong>{displayTime(reservation.start)}</strong><span>{displayTime(reservation.end)}</span></time>
                              <span className="facilities-reservation-copy"><strong>{reservation.title}</strong><small>{facility?.name} · {facility?.building ?? 'Unassigned'} · {reservation.requesterName}</small></span>
                              <span className="facilities-badges">
                                {reservation.seriesId && <em>Series</em>}
                                {reservation.groupId && <em>Group</em>}
                                {reservation.notes && <em>Setup</em>}
                                {reservation.external && <em>External</em>}
                                {reservation.conflicted && <em className="danger">Conflict</em>}
                              </span>
                            </button>
                            <ActionMenu label={`Actions for ${reservation.title}`} testId={`facility-reservation-menu-${reservation.id}`}>
                              <button className="menu-item" role="menuitem" type="button" onClick={() => openReservationEditor(reservation)} data-testid={`facility-reservation-menu-edit-${reservation.id}`}>Edit reservation</button>
                              <button className="menu-item danger-item" role="menuitem" type="button" onClick={() => (reservation.seriesId ? setDeleteSeriesTarget(reservation) : setDeleteReservationTarget(reservation))} data-testid={`facility-reservation-menu-delete-${reservation.id}`}>
                                {reservation.seriesId ? 'Delete series' : 'Delete reservation'}
                              </button>
                            </ActionMenu>
                          </article>
                        );
                      }) : (
                        <div className="facilities-local-empty" role="status" data-testid="facilities-no-results">
                          <h3>No reservations in this range</h3>
                          <p>Change the date range or clear a filter to inspect another part of the schedule.</p>
                          <button className="secondary-button" type="button" onClick={clearFilters} data-testid="facilities-clear-filters">Reset range and filters</button>
                        </div>
                      )}
                    </div>
                  </section>
                </div>

                <aside className="facilities-inspector" aria-label="Reservation inspector" data-testid="facility-inspector">
                  {selectedReservation ? (
                    <section className="facilities-detail-sheet" aria-labelledby="facility-reservation-detail-title">
                      <div className="facilities-detail-heading">
                        <div>
                          <span>{selectedReservation.seriesId ? 'Recurring series' : 'Reservation'}</span>
                          <h2 id="facility-reservation-detail-title">{selectedReservation.title}</h2>
                        </div>
                      </div>
                      <dl className="facilities-detail-grid">
                        <div><dt>Room</dt><dd>{facilities.find((item) => item.id === selectedReservation.facilityId)?.name}</dd></div>
                        <div><dt>Time</dt><dd>{displayTime(selectedReservation.start)}–{displayTime(selectedReservation.end)}</dd></div>
                        <div><dt>Requester</dt><dd>{selectedReservation.requesterName}</dd></div>
                        <div className="span-all"><dt>Setup notes</dt><dd>{selectedReservation.notes || 'No setup notes'}</dd></div>
                      </dl>
                      <div className="facilities-detail-actions">
                        <button className="text-danger-button" type="button" disabled={mutationPending} onClick={() => (selectedReservation.seriesId ? setDeleteSeriesTarget(selectedReservation) : setDeleteReservationTarget(selectedReservation))} data-testid="facility-inspector-delete">
                          {selectedReservation.seriesId ? 'Delete entire series' : 'Delete reservation'}
                        </button>
                      </div>
                    </section>
                  ) : (
                    <div className="facilities-inspector-empty"><span>Select a reservation</span><p>Choose a schedule row to inspect its room, timing, requester, and setup notes.</p></div>
                  )}
                </aside>
              </div>
            ) : (
              <div className="facilities-rooms">
                <div className="facilities-manager-bar" data-testid="facility-manager-bar">
                  <div><strong>Space operations</strong><span>Manage rooms and automation-created reservations.</span></div>
                  <fieldset disabled={mutationPending}>
                    <legend className="sr-only">Room manager actions</legend>
                    <button className="secondary-button" type="button" onClick={openAutomation} data-testid="facility-automation-manage">Manage automation reservations</button>
                    <button className="primary-button" type="button" onClick={() => openFacilityEditor(null)} data-testid="facility-add-space">Add Space</button>
                  </fieldset>
                </div>
                <div className="facilities-split-shell facilities-room-split">
                  <div className="facilities-list-pane facilities-building-list" data-testid="facilities-rooms-list">
                    {groupedFacilities.map((group) => (
                      <section className="facilities-building" key={group.building ?? 'unassigned'} data-testid={`facility-building-${slug(group.building ?? 'unassigned')}`}>
                        <header><h2>{group.building ?? 'Unassigned'}</h2><span>{group.facilities.length} space{group.facilities.length === 1 ? '' : 's'}</span></header>
                        <div>
                          {group.facilities.map((facility) => {
                            const upcoming = reservations.filter((reservation) => reservation.facilityId === facility.id && !reservation.automation).length;
                            return (
                              <article className="facilities-room-row" key={facility.id} aria-current={selectedRoomId === facility.id ? 'true' : undefined} data-testid={`facility-room-${facility.id}`}>
                                <button className="facilities-room-open" type="button" onClick={() => setSelectedRoomId(facility.id)} data-testid={`facility-room-open-${facility.id}`}>
                                  <span className="facilities-room-copy"><strong>{facility.name}</strong><small>{facility.description}</small></span>
                                  <span className="facilities-room-status">{upcoming ? `${upcoming} upcoming` : 'Available'}</span>
                                </button>
                                <button className="secondary-button" type="button" disabled={mutationPending} onClick={() => openReservationEditor(null, facility.id)} data-testid={`facility-room-reserve-${facility.id}`}>Reserve</button>
                                <ActionMenu label={`Manage ${facility.name}`} testId={`facility-room-menu-${facility.id}`}>
                                  <button className="menu-item danger-item" role="menuitem" type="button" onClick={() => setDeleteFacilityTarget(facility)} data-testid={`facility-room-menu-delete-${facility.id}`}>Delete room</button>
                                </ActionMenu>
                              </article>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                  <aside className="facilities-inspector" aria-label="Room inspector">
                    {selectedRoom ? (
                      <section className="facilities-detail-sheet" aria-labelledby="facility-room-detail-title">
                        <div className="facilities-detail-heading"><div><span>{selectedRoom.building ?? 'Unassigned'}</span><h2 id="facility-room-detail-title">{selectedRoom.name}</h2><p>{selectedRoom.description}</p></div></div>
                        <div className="facilities-room-preview">
                          <div className="facilities-inspector-section-heading"><h3>Upcoming reservations</h3><span>{reservations.filter((item) => item.facilityId === selectedRoom.id && !item.automation).length}</span></div>
                          {reservations.filter((item) => item.facilityId === selectedRoom.id && !item.automation).slice(0, 5).map((reservation) => (
                            <div key={reservation.id}><strong>{reservation.title}</strong><span>{displayTime(reservation.start)}</span></div>
                          ))}
                        </div>
                        <div className="facilities-detail-actions">
                          <button className="primary-button" type="button" disabled={mutationPending} onClick={() => openReservationEditor(null, selectedRoom.id)} data-testid="facility-room-inspector-reserve">Reserve this room</button>
                          <button className="secondary-button" type="button" disabled={mutationPending} onClick={() => openFacilityEditor(selectedRoom)} data-testid="facility-room-inspector-edit">Edit space</button>
                        </div>
                      </section>
                    ) : (
                      <div className="facilities-inspector-empty"><span>Select a room</span><p>Choose a room to inspect its description and upcoming reservations.</p></div>
                    )}
                  </aside>
                </div>
              </div>
            )}
          </>
        )}

        <FocusDialog open={reservationDialogOpen} onClose={closeReservationEditor} title={editingReservation ? 'Edit reservation' : 'Reserve space'} description="Availability is calculated from the current room schedule." testId="facility-reservation-dialog" wide>
          <form className="facilities-reservation-form" onSubmit={(event) => void submitReservation(event)}>
            <div className="facilities-form-grid">
              <label className="field span-2">Title
                <input data-autofocus value={formTitle} onChange={(event) => setFormTitle(event.target.value)} aria-invalid={Boolean(formErrors.title)} data-testid="facility-form-title" />
                {formErrors.title && <span className="facilities-field-error" role="alert" data-testid="facility-form-title-error">{formErrors.title}</span>}
              </label>
              <label className="field">Room
                <select value={formRoomId} onChange={(event) => setFormRoomId(event.target.value)} data-testid="facility-form-room">
                  {facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}
                </select>
                {formErrors.room && <span className="facilities-field-error" role="alert" data-testid="facility-form-room-error">{formErrors.room}</span>}
              </label>
              <label className="field">Date<input type="date" value={formDate} onChange={(event) => setFormDate(event.target.value)} data-testid="facility-form-date" /></label>
              <label className="field">Start time<input type="time" value={formStart} onChange={(event) => setFormStart(event.target.value)} data-testid="facility-form-start" /></label>
              <label className="field">End time<input type="time" value={formEnd} onChange={(event) => setFormEnd(event.target.value)} data-testid="facility-form-end" /></label>
              <label className="field span-2">Setup notes<textarea rows={3} value={formNotes} onChange={(event) => setFormNotes(event.target.value)} data-testid="facility-form-notes" /></label>
            </div>
            <section className={`facilities-availability ${formConflicts.length ? 'conflict' : ''}`} aria-live="polite">
              <strong data-testid="facility-form-availability">{availabilityText}</strong>
            </section>
            {formErrors.slot && <div className="facilities-form-alert" role="alert" data-testid="facility-form-slot-error">{formErrors.slot}</div>}
            <footer className="dialog-actions">
              <button className="secondary-button" type="button" onClick={closeReservationEditor} data-testid="facility-form-cancel">Cancel</button>
              <button className="primary-button" type="submit" data-testid="facility-form-submit">{editingReservation ? 'Save changes' : 'Create reservation'}</button>
            </footer>
          </form>
        </FocusDialog>

        <FocusDialog open={facilityEditorOpen} onClose={closeFacilityEditor} title={editingFacility ? 'Edit space' : 'Add space'} description="Facilities use only the room name, building, and description fields exposed by Rhythm." testId="facility-editor-dialog">
          <form onSubmit={(event) => void submitFacility(event)}>
            <label className="field">Room name
              <input data-autofocus value={facilityName} onChange={(event) => { setFacilityName(event.target.value); setFacilityNameError(''); }} aria-invalid={Boolean(facilityNameError)} data-testid="facility-editor-name" />
              {facilityNameError && <span className="facilities-field-error" role="alert" data-testid="facility-editor-name-error">{facilityNameError}</span>}
            </label>
            <label className="field">Building
              <select value={facilityBuilding} onChange={(event) => setFacilityBuilding(event.target.value)} data-testid="facility-editor-building">
                <option value="">Unassigned</option>
                {buildings.map((building) => <option key={building} value={building}>{building}</option>)}
                <option value="__new_building__">Add a new building…</option>
              </select>
            </label>
            {facilityBuilding === '__new_building__' && (
              <label className="field">New building name<input value={newBuilding} onChange={(event) => setNewBuilding(event.target.value)} data-testid="facility-editor-new-building" /></label>
            )}
            <label className="field">Description<textarea rows={4} value={facilityDescription} onChange={(event) => setFacilityDescription(event.target.value)} data-testid="facility-editor-description" /></label>
            <footer className="dialog-actions">
              <button className="secondary-button" type="button" onClick={closeFacilityEditor} data-testid="facility-editor-cancel">Cancel</button>
              <button className="primary-button" type="submit" data-testid="facility-editor-submit">{editingFacility ? 'Save changes' : 'Add Space'}</button>
            </footer>
          </form>
        </FocusDialog>

        <FocusDialog open={automationOpen} onClose={() => setAutomationOpen(false)} title="Manage automation reservations" description="Preview the exact cleanup scope before deleting automation-created reservations." testId="facility-automation-dialog" wide>
          <div className="facilities-automation-form">
            <div className="facilities-form-grid">
              <label className="field">Room
                <select value={automationRoom} onChange={(event) => setAutomationRoom(event.target.value)} data-testid="facility-automation-room-filter">
                  <option value="">All rooms</option>
                  {facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}
                </select>
              </label>
              <label className="field">Start after<input type="date" value={automationStart} onChange={(event) => setAutomationStart(event.target.value)} data-testid="facility-automation-start-after" /></label>
              <label className="field">End before<input type="date" value={automationEnd} onChange={(event) => setAutomationEnd(event.target.value)} data-testid="facility-automation-end-before" /></label>
            </div>
            {filteredAutomation.length ? (
              <section className="facilities-automation-preview" aria-live="polite">
                <div><span>Reservations in scope</span><strong data-testid="facility-automation-total">{filteredAutomation.length}</strong></div>
              </section>
            ) : (
              <section className="facilities-automation-zero" role="status" data-testid="facility-automation-zero"><h3>No automation-created reservations</h3><p>Adjust the room or date bounds to preview a different cleanup scope.</p></section>
            )}
            <footer className="dialog-actions">
              <button className="secondary-button" type="button" onClick={() => setAutomationOpen(false)} data-testid="facility-automation-cancel">Cancel</button>
              {filteredAutomation.length > 0 && <button className="danger-button" type="button" disabled={mutationPending} onClick={() => void cleanupAutomation()} data-testid="facility-automation-delete">Delete {filteredAutomation.length} reservations</button>}
            </footer>
          </div>
        </FocusDialog>

        <FocusDialog open={Boolean(deleteReservationTarget)} onClose={() => setDeleteReservationTarget(null)} title={deleteReservationTarget ? `Delete "${deleteReservationTarget.title}"?` : 'Delete reservation?'} description="This cannot be undone." testId="facility-reservation-delete-dialog">
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={() => setDeleteReservationTarget(null)} data-testid="facility-reservation-delete-cancel">Cancel</button>
            <button className="danger-button" type="button" disabled={mutationPending} onClick={() => void confirmDeleteReservation()} data-testid="facility-reservation-delete-confirm">Delete reservation</button>
          </div>
        </FocusDialog>

        <FocusDialog open={Boolean(deleteSeriesTarget)} onClose={() => setDeleteSeriesTarget(null)} title={deleteSeriesTarget ? `Delete entire series "${deleteSeriesTarget.title}"?` : 'Delete series?'} description="Every occurrence in this recurring series will be removed. This cannot be undone." testId="facility-series-delete-dialog">
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={() => setDeleteSeriesTarget(null)} data-testid="facility-series-delete-cancel">Cancel</button>
            <button className="danger-button" type="button" disabled={mutationPending} onClick={() => void confirmDeleteSeries()} data-testid="facility-series-delete-confirm">Delete entire series</button>
          </div>
        </FocusDialog>

        <FocusDialog open={Boolean(deleteFacilityTarget)} onClose={() => setDeleteFacilityTarget(null)} title={deleteFacilityTarget ? `Delete "${deleteFacilityTarget.name}"?` : 'Delete space?'} description="This removes the room and its reservations from this workspace. This cannot be undone." testId="facility-delete-dialog">
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={() => setDeleteFacilityTarget(null)} data-testid="facility-delete-cancel">Cancel</button>
            <button className="danger-button" type="button" disabled={mutationPending} onClick={() => void confirmDeleteFacility()} data-testid="facility-delete-confirm">Delete space</button>
          </div>
        </FocusDialog>
      </section>
    </ScreenRoot>
  );
}
